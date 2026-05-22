import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { prisma } from '../db.js';
import { hashPassword } from '../auth.js';
import { badRequest, conflict } from '../errors.js';
import { logAudit } from '../audit.js';
import { asyncHandler } from '../asyncHandler.js';
import { setupInitialSchema } from '../validation.js';

export const setupRouter = Router();

/**
 * Setup endpoints are PUBLIC (no JWT) by design — they bootstrap the very
 * first admin account. They become 409 once any user exists in DB, so they
 * can't be replayed to escalate.
 */
const setupLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'too_many_requests', message: 'Trop de tentatives, réessayez plus tard.' },
});

setupRouter.use(setupLimiter);

setupRouter.get(
  '/status',
  asyncHandler(async (_req, res) => {
    const count = await prisma.user.count();
    res.json({ needsSetup: count === 0 });
  }),
);

setupRouter.post(
  '/initial-admin',
  asyncHandler(async (req, res) => {
    const userCount = await prisma.user.count();
    if (userCount > 0) {
      throw conflict('Setup déjà effectué — un utilisateur existe déjà.');
    }
    const parsed = setupInitialSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('payload invalide', parsed.error.flatten());
    const { username, email, authHash, protectedVaultKey, recoveryHash, recoveryProtectedKey } =
      parsed.data;

    // Le serveur ne reçoit que des hashes/blobs : ni le mot de passe maître,
    // ni le code de récupération ne lui sont accessibles.
    const user = await prisma.user.create({
      data: {
        username,
        email,
        passwordHash: await hashPassword(authHash),
        role: 'ADMIN',
        protectedVaultKey,
        recoveryHash: await hashPassword(recoveryHash),
        recoveryProtectedKey,
      },
    });

    await logAudit({
      action: 'USER_CREATED',
      req,
      userId: user.id,
      username: user.username,
      details: { wizard: true, first: true, role: 'ADMIN' },
    });

    // Pas de session ouverte ici : l'utilisateur se connecte ensuite via la
    // page de login (le flux complet de dérivation des clés est ainsi exercé).
    res.status(201).json({
      user: { id: user.id, username: user.username, email: user.email, role: user.role },
    });
  }),
);
