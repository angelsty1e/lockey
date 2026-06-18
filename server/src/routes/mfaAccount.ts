import { Router } from 'express';
import bcrypt from 'bcrypt';
import rateLimit from 'express-rate-limit';
import { prisma } from '../db.js';
import { requireAuth, requireSession, comparePassword } from '../auth.js';
import { asyncHandler } from '../asyncHandler.js';
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../errors.js';
import { logAudit } from '../audit.js';
import { vaultEncrypt, vaultDecrypt, vaultIsConfigured } from '../utils/vaultCrypto.js';
import {
  buildOtpauthQr,
  buildOtpauthUrl,
  generateBackupCodes,
  generateTotpSecret,
  normalizeBackupCode,
  verifyTotp,
} from '../utils/mfa.js';
import {
  mfaDisableSchema,
  mfaEnableSchema,
  mfaRegenerateCodesSchema,
} from '../validation.js';

export const mfaAccountRouter = Router();

mfaAccountRouter.use(requireAuth, requireSession);

// Limite stricte sur les endpoints qui consomment un code (anti-bruteforce).
// Compteur par userId — plus serré que la limite globale.
const codeLimiter = rateLimit({
  windowMs: 60_000,
  limit: 8,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: req => req.user?.id ?? req.ip ?? 'anon',
  message: { error: 'too_many_requests', message: 'Trop de tentatives — réessaie dans une minute.' },
});

function ensureVaultReady() {
  if (!vaultIsConfigured()) {
    throw new Error('VAULT_MASTER_KEY non configuré : impossible d\'utiliser le MFA');
  }
}

/** GET — état du MFA pour l'utilisateur courant. */
mfaAccountRouter.get(
  '/status',
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { mfaEnabled: true, mfaActivatedAt: true },
    });
    if (!user) throw notFound('utilisateur introuvable');
    const remaining = user.mfaEnabled
      ? await prisma.mfaBackupCode.count({ where: { userId, usedAt: null } })
      : 0;
    res.json({
      enabled: user.mfaEnabled,
      activatedAt: user.mfaActivatedAt,
      backupCodesRemaining: remaining,
    });
  }),
);

/**
 * POST /setup — démarre l'enrôlement.
 * Génère un secret TOTP, le stocke chiffré en `mfaPendingSecret` (écrase tout
 * setup précédent non finalisé), renvoie l'URI otpauth + QR pour scan.
 */
mfaAccountRouter.post(
  '/setup',
  asyncHandler(async (req, res) => {
    ensureVaultReady();
    const userId = req.user!.id;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { username: true, mfaEnabled: true },
    });
    if (!user) throw notFound('utilisateur introuvable');
    if (user.mfaEnabled) throw conflict('le 2FA est déjà activé');

    const secret = generateTotpSecret();
    const otpauthUrl = buildOtpauthUrl(secret, user.username);
    const qrDataUrl = await buildOtpauthQr(otpauthUrl);

    await prisma.user.update({
      where: { id: userId },
      // F2 — secret lié à l'utilisateur (AAD=userId) : un déplacement de ce blob
      // vers la ligne d'un autre compte échouera au déchiffrement.
      data: { mfaPendingSecret: vaultEncrypt(secret, userId) },
    });

    await logAudit({ action: 'MFA_SETUP_INITIATED', req });

    res.json({ otpauthUrl, qrDataUrl, secret });
  }),
);

/**
 * POST /enable — finalise l'enrôlement.
 * Vérifie un code TOTP face au secret pending → si OK : promeut le secret en
 * actif, génère 8 codes de secours (renvoyés une seule fois), bump
 * tokenVersion (toutes les autres sessions web doivent reauth).
 */
mfaAccountRouter.post(
  '/enable',
  codeLimiter,
  asyncHandler(async (req, res) => {
    ensureVaultReady();
    const parsed = mfaEnableSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('payload invalide', parsed.error.flatten());

    const userId = req.user!.id;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { mfaEnabled: true, mfaPendingSecret: true },
    });
    if (!user) throw notFound('utilisateur introuvable');
    if (user.mfaEnabled) throw conflict('le 2FA est déjà activé');
    if (!user.mfaPendingSecret) throw badRequest('aucun setup en cours — recommence depuis le début');

    const secret = vaultDecrypt(user.mfaPendingSecret, userId);
    if (!verifyTotp(secret, parsed.data.code)) {
      throw unauthorized('code invalide');
    }

    const { plain, hashes } = await generateBackupCodes();

    await prisma.$transaction(async tx => {
      await tx.user.update({
        where: { id: userId },
        data: {
          mfaEnabled: true,
          mfaSecret: vaultEncrypt(secret, userId),
          mfaPendingSecret: null,
          mfaActivatedAt: new Date(),
          // Invalide les autres sessions web : elles devront reauth (avec MFA).
          tokenVersion: { increment: 1 },
        },
      });
      await tx.mfaBackupCode.deleteMany({ where: { userId } });
      await tx.mfaBackupCode.createMany({
        data: hashes.map(h => ({ userId, codeHash: h })),
      });
    });

    await logAudit({ action: 'MFA_ENABLED', req });

    res.json({ enabled: true, backupCodes: plain });
  }),
);

/**
 * POST /disable — désactive le 2FA.
 * Demande la preuve du mot de passe maître (`authHash`) + un code TOTP
 * (double preuve : connaissance + possession).
 */
mfaAccountRouter.post(
  '/disable',
  codeLimiter,
  asyncHandler(async (req, res) => {
    ensureVaultReady();
    const parsed = mfaDisableSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('payload invalide', parsed.error.flatten());

    const userId = req.user!.id;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { mfaEnabled: true, mfaSecret: true, passwordHash: true },
    });
    if (!user) throw notFound('utilisateur introuvable');
    if (!user.mfaEnabled || !user.mfaSecret) throw conflict('le 2FA n\'est pas activé');

    const pwOk = await comparePassword(parsed.data.authHash, user.passwordHash);
    if (!pwOk) throw unauthorized('mot de passe incorrect');

    const secret = vaultDecrypt(user.mfaSecret, userId);
    if (!verifyTotp(secret, parsed.data.code)) throw unauthorized('code invalide');

    await prisma.$transaction(async tx => {
      await tx.user.update({
        where: { id: userId },
        data: {
          mfaEnabled: false,
          mfaSecret: null,
          mfaPendingSecret: null,
          mfaActivatedAt: null,
          tokenVersion: { increment: 1 },
        },
      });
      await tx.mfaBackupCode.deleteMany({ where: { userId } });
    });

    await logAudit({ action: 'MFA_DISABLED', req });

    res.json({ enabled: false });
  }),
);

/**
 * POST /regenerate-codes — nouvelle série de codes de secours.
 * Invalide tous les codes précédents (utilisés ou non).
 */
mfaAccountRouter.post(
  '/regenerate-codes',
  codeLimiter,
  asyncHandler(async (req, res) => {
    ensureVaultReady();
    const parsed = mfaRegenerateCodesSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('payload invalide', parsed.error.flatten());

    const userId = req.user!.id;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { mfaEnabled: true, mfaSecret: true },
    });
    if (!user || !user.mfaEnabled || !user.mfaSecret) {
      throw forbidden('le 2FA n\'est pas activé');
    }

    const secret = vaultDecrypt(user.mfaSecret, userId);
    if (!verifyTotp(secret, parsed.data.code)) throw unauthorized('code invalide');

    const { plain, hashes } = await generateBackupCodes();

    await prisma.$transaction(async tx => {
      await tx.mfaBackupCode.deleteMany({ where: { userId } });
      await tx.mfaBackupCode.createMany({
        data: hashes.map(h => ({ userId, codeHash: h })),
      });
    });

    await logAudit({ action: 'MFA_BACKUP_CODES_REGENERATED', req });

    res.json({ backupCodes: plain });
  }),
);

// Aide partagée avec auth.ts pour la consommation d'un backup code à l'étape login.
// Vrai si un code matche et a été marqué `usedAt` ; faux sinon.
export async function consumeBackupCode(userId: string, rawCode: string): Promise<boolean> {
  const normalized = normalizeBackupCode(rawCode);
  if (!/^[a-z0-9]{8}$/.test(normalized)) return false;
  const candidates = await prisma.mfaBackupCode.findMany({
    where: { userId, usedAt: null },
    select: { id: true, codeHash: true },
  });
  for (const c of candidates) {
    if (await bcrypt.compare(normalized, c.codeHash)) {
      // S5 — consommation atomique : `updateMany` conditionné sur `usedAt: null`
      // garantit qu'une seule requête concurrente marque le code. Si deux
      // requêtes présentent le même code en parallèle, l'une obtient count=1,
      // l'autre count=0 (déjà consommé) → pas de double-usage (CWE-362).
      const consumed = await prisma.mfaBackupCode.updateMany({
        where: { id: c.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      return consumed.count === 1;
    }
  }
  return false;
}
