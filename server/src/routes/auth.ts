import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { prisma } from '../db.js';
import {
  comparePassword,
  requireAuth,
  signJwt,
  signMfaChallenge,
  verifyMfaChallenge,
} from '../auth.js';
import { setSessionCookie, clearSessionCookie } from '../cookies.js';
import { loginSchema, mfaLoginVerifySchema, recoverSchema } from '../validation.js';
import { badRequest, unauthorized } from '../errors.js';
import { logAudit } from '../audit.js';
import { asyncHandler } from '../asyncHandler.js';
import { vaultDecrypt } from '../utils/vaultCrypto.js';
import { verifyTotp } from '../utils/mfa.js';
import { consumeBackupCode } from './mfaAccount.js';

export const authRouter = Router();

// Limite serrée par IP sur l'étape 2 (verify MFA) pour bloquer le bruteforce
// du code 6-chiffres (10^6 → faisable en quelques heures sans throttling).
const mfaVerifyLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'too_many_requests', message: 'Trop de tentatives — réessaie dans une minute.' },
});

// Limite le bruteforce du code de récupération.
const recoverLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'too_many_requests', message: 'Trop de tentatives, réessaie dans 15 minutes.' },
});

/**
 * POST /login — étape 1 : preuve de connaissance du mot de passe maître.
 *
 * Le client envoie `authHash` (PBKDF2 du mot de passe maître dérivé dans le
 * navigateur), jamais le mot de passe en clair. Le serveur le compare au
 * bcrypt stocké.
 *
 * Si l'utilisateur n'a pas le 2FA → ouvre la session immédiatement et renvoie
 * `protectedVaultKey` (clé de chiffrement emballée) pour que le client la déballe.
 * Si l'utilisateur a le 2FA → renvoie `{ mfaRequired, mfaToken }`.
 */
authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('payload invalide', parsed.error.flatten());
    const { username, authHash } = parsed.data;

    const user = await prisma.user.findUnique({ where: { username } });
    if (!user || !user.active) {
      await logAudit({ action: 'LOGIN_FAILED', req, username, success: false, details: { reason: 'unknown_or_inactive' } });
      throw unauthorized('identifiants invalides');
    }

    const ok = await comparePassword(authHash, user.passwordHash);
    if (!ok) {
      await logAudit({ action: 'LOGIN_FAILED', req, username, userId: user.id, success: false });
      throw unauthorized('identifiants invalides');
    }

    if (user.mfaEnabled) {
      const mfaToken = signMfaChallenge({ sub: user.id, tv: user.tokenVersion });
      // Pas d'audit LOGIN ici : on log seulement quand l'étape 2 réussit.
      res.json({ mfaRequired: true, mfaToken });
      return;
    }

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await logAudit({ action: 'LOGIN', req, userId: user.id, username: user.username });

    const token = signJwt({ sub: user.id, username: user.username, tv: user.tokenVersion });
    setSessionCookie(res, token);
    res.json({
      user: { id: user.id, username: user.username, email: user.email, role: user.role },
      protectedVaultKey: user.protectedVaultKey,
    });
  }),
);

/**
 * POST /login/mfa — étape 2 : vérification du code TOTP ou d'un backup code.
 */
authRouter.post(
  '/login/mfa',
  mfaVerifyLimiter,
  asyncHandler(async (req, res) => {
    const parsed = mfaLoginVerifySchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('payload invalide', parsed.error.flatten());

    let payload;
    try {
      payload = verifyMfaChallenge(parsed.data.mfaToken);
    } catch {
      throw unauthorized('challenge MFA expiré ou invalide');
    }

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.active || !user.mfaEnabled || !user.mfaSecret) {
      throw unauthorized('challenge MFA invalide');
    }
    // Si l'utilisateur a logout ou changé de mdp entre les 2 étapes, le
    // tokenVersion a bougé → on refuse (force à reprendre depuis le mdp).
    if (payload.tv !== user.tokenVersion) {
      throw unauthorized('challenge MFA invalide');
    }

    let viaBackup = false;
    if (parsed.data.code) {
      const secret = vaultDecrypt(user.mfaSecret);
      if (!verifyTotp(secret, parsed.data.code)) {
        await logAudit({
          action: 'LOGIN_FAILED',
          req,
          userId: user.id,
          username: user.username,
          success: false,
          details: { reason: 'mfa_wrong_code' },
        });
        throw unauthorized('code invalide');
      }
    } else if (parsed.data.backupCode) {
      const ok = await consumeBackupCode(user.id, parsed.data.backupCode);
      if (!ok) {
        await logAudit({
          action: 'LOGIN_FAILED',
          req,
          userId: user.id,
          username: user.username,
          success: false,
          details: { reason: 'mfa_wrong_backup_code' },
        });
        throw unauthorized('code de secours invalide');
      }
      viaBackup = true;
      await logAudit({ action: 'MFA_BACKUP_CODE_USED', req, userId: user.id, username: user.username });
    }

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await logAudit({
      action: 'MFA_VERIFIED',
      req,
      userId: user.id,
      username: user.username,
      details: { viaBackup },
    });
    await logAudit({ action: 'LOGIN', req, userId: user.id, username: user.username });

    const token = signJwt({ sub: user.id, username: user.username, tv: user.tokenVersion });
    setSessionCookie(res, token);
    res.json({
      user: { id: user.id, username: user.username, email: user.email, role: user.role },
      protectedVaultKey: user.protectedVaultKey,
    });
  }),
);

/**
 * POST /recover — porte de secours : connexion via le code de récupération
 * quand le mot de passe maître est oublié.
 *
 * Le client envoie `recoveryHash` (dérivé du code de récupération dans le
 * navigateur). En cas de succès, on ouvre une session et on renvoie
 * `recoveryProtectedKey` : le client déballe la clé de chiffrement avec le code de
 * récupération, puis impose un nouveau mot de passe maître via
 * POST /api/account/master-password.
 *
 * Note : ce flux contourne le 2FA — le code de récupération (≈125 bits) fait
 * lui-même office de second facteur fort.
 */
authRouter.post(
  '/recover',
  recoverLimiter,
  asyncHandler(async (req, res) => {
    const parsed = recoverSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('payload invalide', parsed.error.flatten());
    const { username, recoveryHash } = parsed.data;

    const user = await prisma.user.findUnique({ where: { username } });
    if (!user || !user.active || !user.recoveryHash || !user.recoveryProtectedKey) {
      await logAudit({
        action: 'LOGIN_FAILED',
        req,
        username,
        success: false,
        details: { reason: 'recovery_unavailable' },
      });
      throw unauthorized('récupération impossible');
    }

    const ok = await comparePassword(recoveryHash, user.recoveryHash);
    if (!ok) {
      await logAudit({
        action: 'LOGIN_FAILED',
        req,
        username,
        userId: user.id,
        success: false,
        details: { reason: 'recovery_wrong_code' },
      });
      throw unauthorized('code de récupération invalide');
    }

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await logAudit({ action: 'LOGIN', req, userId: user.id, username: user.username, details: { recovery: true } });

    const token = signJwt({ sub: user.id, username: user.username, tv: user.tokenVersion });
    setSessionCookie(res, token);
    res.json({
      user: { id: user.id, username: user.username, email: user.email, role: user.role },
      recoveryProtectedKey: user.recoveryProtectedKey,
    });
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        id: true,
        username: true,
        email: true,
        active: true,
        role: true,
        lastLoginAt: true,
        protectedVaultKey: true,
        passkeyCredentialId: true,
        passkeyPrfSalt: true,
        passkeyProtectedKey: true,
      },
    });
    const passkey =
      user?.passkeyCredentialId && user.passkeyPrfSalt && user.passkeyProtectedKey
        ? {
            credentialId: user.passkeyCredentialId,
            prfSalt: user.passkeyPrfSalt,
            passkeyProtectedKey: user.passkeyProtectedKey,
          }
        : null;
    res.json({
      user: user && {
        id: user.id,
        username: user.username,
        email: user.email,
        active: user.active,
        role: user.role,
        lastLoginAt: user.lastLoginAt,
      },
      via: req.user!.via,
      protectedVaultKey: user?.protectedVaultKey ?? null,
      passkey,
    });
  }),
);

authRouter.post(
  '/logout',
  requireAuth,
  asyncHandler(async (req, res) => {
    // Bump tokenVersion to invalidate any other live session/tab for this user.
    if (req.user!.via === 'jwt') {
      await prisma.user.update({
        where: { id: req.user!.id },
        data: { tokenVersion: { increment: 1 } },
      });
    }
    clearSessionCookie(res);
    await logAudit({ action: 'LOGOUT', req });
    res.json({ ok: true });
  }),
);
