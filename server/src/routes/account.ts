import { Router } from 'express';
import { prisma } from '../db.js';
import { hashPassword, requireAuth, requireSession, signJwt } from '../auth.js';
import { setSessionCookie } from '../cookies.js';
import { masterPasswordSchema, initVaultSchema, passkeySchema } from '../validation.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { logAudit } from '../audit.js';
import { asyncHandler } from '../asyncHandler.js';

export const accountRouter = Router();

accountRouter.use(requireAuth, requireSession);

/**
 * POST /master-password — change le mot de passe maître de l'utilisateur
 * courant.
 *
 * Le client a ré-emballé la clé de chiffrement côté navigateur : la clé
 * elle-même ne change pas (donc ni les éléments chiffrés ni le code de
 * récupération ne sont affectés), seuls `authHash` et `protectedVaultKey`
 * sont renouvelés.
 *
 * `tokenVersion` est incrémenté pour invalider les autres sessions ; la
 * session courante reçoit un cookie ré-émis afin de rester valide.
 */
accountRouter.post(
  '/master-password',
  asyncHandler(async (req, res) => {
    const parsed = masterPasswordSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('payload invalide', parsed.error.flatten());

    const updated = await prisma.user.update({
      where: { id: req.user!.id },
      data: {
        passwordHash: await hashPassword(parsed.data.authHash),
        protectedVaultKey: parsed.data.protectedVaultKey,
        tokenVersion: { increment: 1 },
      },
      select: { id: true, username: true, tokenVersion: true },
    });

    await logAudit({
      action: 'USER_UPDATED',
      req,
      details: { targetUserId: updated.id, fields: ['masterPassword'] },
    });

    // Ré-émet le cookie avec le nouveau tokenVersion pour ne pas déconnecter
    // la session en cours.
    const token = signJwt({ sub: updated.id, username: updated.username, tv: updated.tokenVersion });
    setSessionCookie(res, token);
    res.json({ ok: true });
  }),
);

/**
 * POST /init-vault — initialise Lockey (zéro-connaissance) pour un compte créé
 * par un administrateur (lequel ne pouvait pas générer la clé de chiffrement).
 *
 * Appelé une seule fois, à la première connexion : refuse si Lockey est
 * déjà initialisé.
 */
accountRouter.post(
  '/init-vault',
  asyncHandler(async (req, res) => {
    const parsed = initVaultSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('payload invalide', parsed.error.flatten());

    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { protectedVaultKey: true },
    });
    if (!user) throw notFound('utilisateur introuvable');
    if (user.protectedVaultKey) throw conflict('Lockey est déjà initialisé');

    await prisma.user.update({
      where: { id: req.user!.id },
      data: {
        protectedVaultKey: parsed.data.protectedVaultKey,
        recoveryHash: await hashPassword(parsed.data.recoveryHash),
        recoveryProtectedKey: parsed.data.recoveryProtectedKey,
      },
    });

    await logAudit({
      action: 'USER_UPDATED',
      req,
      details: { targetUserId: req.user!.id, fields: ['initVault'] },
    });

    res.json({ ok: true });
  }),
);

/**
 * POST /passkey — enregistre (ou remplace) la passkey de déverrouillage de
 * l'utilisateur courant. Le serveur ne stocke que des données opaques.
 */
accountRouter.post(
  '/passkey',
  asyncHandler(async (req, res) => {
    const parsed = passkeySchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('payload invalide', parsed.error.flatten());

    await prisma.user.update({
      where: { id: req.user!.id },
      data: {
        passkeyCredentialId: parsed.data.credentialId,
        passkeyPrfSalt: parsed.data.prfSalt,
        passkeyProtectedKey: parsed.data.passkeyProtectedKey,
      },
    });

    await logAudit({
      action: 'USER_UPDATED',
      req,
      details: { targetUserId: req.user!.id, fields: ['passkey'] },
    });

    res.json({ ok: true });
  }),
);

/** DELETE /passkey — retire la passkey de déverrouillage. */
accountRouter.delete(
  '/passkey',
  asyncHandler(async (req, res) => {
    await prisma.user.update({
      where: { id: req.user!.id },
      data: { passkeyCredentialId: null, passkeyPrfSalt: null, passkeyProtectedKey: null },
    });

    await logAudit({
      action: 'USER_UPDATED',
      req,
      details: { targetUserId: req.user!.id, fields: ['passkey:removed'] },
    });

    res.json({ ok: true });
  }),
);
