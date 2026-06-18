import { Router } from 'express';
import { prisma } from '../db.js';
import { hashPassword, requireAuth, requireSession, requireAdmin } from '../auth.js';
import { userCreateSchema, userUpdateSchema, idSchema } from '../validation.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { logAudit } from '../audit.js';
import { asyncHandler } from '../asyncHandler.js';

export const usersRouter = Router();

const select = {
  id: true,
  username: true,
  email: true,
  role: true,
  active: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
};

usersRouter.use(requireAuth, requireSession, requireAdmin);

usersRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    // S8 — borne défensive : même réservée aux admins, la liste complète n'a pas
    // à matérialiser un nombre illimité de lignes d'un coup.
    const users = await prisma.user.findMany({
      select,
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });
    res.json(users);
  }),
);

usersRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = userCreateSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('payload invalide', parsed.error.flatten());
    const { username, authHash, email, role } = parsed.data;

    const existing = await prisma.user.findFirst({
      where: { OR: [{ username }, ...(email ? [{ email }] : [])] },
    });
    if (existing) throw conflict('username ou email déjà utilisé');

    // `protectedVaultKey` reste NULL : Lockey (zéro-connaissance) de ce compte
    // est initialisé par l'utilisateur lui-même à sa première connexion.
    const user = await prisma.user.create({
      data: { username, email, passwordHash: await hashPassword(authHash), role: role ?? 'USER' },
      select,
    });
    await logAudit({ action: 'USER_CREATED', req, details: { targetUserId: user.id, username, role: user.role } });
    res.status(201).json(user);
  }),
);

usersRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const parsed = userUpdateSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('payload invalide', parsed.error.flatten());

    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) throw badRequest('id invalide');
    const id = idParsed.data;
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) throw notFound('utilisateur introuvable');

    // Anti-lockout: protect the last active user from being deactivated.
    const willDeactivate = parsed.data.active === false && target.active;
    if (willDeactivate) {
      const otherActive = await prisma.user.count({
        where: { active: true, id: { not: id } },
      });
      if (otherActive === 0) {
        throw badRequest('impossible : il doit toujours rester au moins un utilisateur actif');
      }
    }

    // Anti-lockout admin : empêcher la suppression du dernier ADMIN actif (par
    // demote ou désactivation).
    const willDemote = parsed.data.role === 'USER' && target.role === 'ADMIN';
    if (willDemote || (willDeactivate && target.role === 'ADMIN')) {
      const otherActiveAdmins = await prisma.user.count({
        where: { active: true, role: 'ADMIN', id: { not: id } },
      });
      if (otherActiveAdmins === 0) {
        throw badRequest('impossible : il doit toujours rester au moins un administrateur actif');
      }
    }

    const data: Record<string, unknown> = {};
    if (parsed.data.email !== undefined) data.email = parsed.data.email;
    if (parsed.data.active !== undefined) data.active = parsed.data.active;
    if (parsed.data.role !== undefined) data.role = parsed.data.role;

    // Bump tokenVersion pour révoquer toutes les sessions existantes quand le
    // compte est désactivé ou rétrogradé.
    const shouldBumpTv =
      parsed.data.active === false ||
      (parsed.data.role !== undefined && parsed.data.role !== target.role);
    if (shouldBumpTv) data.tokenVersion = { increment: 1 };

    const updated = await prisma.user.update({ where: { id }, data, select });
    // S10 — tracer les changements sensibles avec leurs valeurs (from→to), pas
    // seulement le nom du champ : une investigation doit pouvoir reconstituer
    // qui a eu le rôle ADMIN, et quand, ainsi que les (dé)activations.
    const changes: Record<string, { from: string | boolean; to: string | boolean }> = {};
    if (parsed.data.role !== undefined && parsed.data.role !== target.role) {
      changes.role = { from: target.role, to: parsed.data.role };
    }
    if (parsed.data.active !== undefined && parsed.data.active !== target.active) {
      changes.active = { from: target.active, to: parsed.data.active };
    }
    await logAudit({
      action: 'USER_UPDATED',
      req,
      details: { targetUserId: id, fields: Object.keys(data), changes },
    });
    res.json(updated);
  }),
);

usersRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) throw badRequest('id invalide');
    const id = idParsed.data;
    if (id === req.user!.id) throw badRequest('un utilisateur ne peut pas se supprimer lui-même');
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) throw notFound('utilisateur introuvable');

    // Anti-lockout admin : refuser la suppression du dernier admin actif.
    if (target.role === 'ADMIN' && target.active) {
      const otherActiveAdmins = await prisma.user.count({
        where: { active: true, role: 'ADMIN', id: { not: id } },
      });
      if (otherActiveAdmins === 0) {
        throw badRequest('impossible : il doit toujours rester au moins un administrateur actif');
      }
    }

    await prisma.user.delete({ where: { id } });
    await logAudit({ action: 'USER_DELETED', req, details: { targetUserId: id, username: target.username } });
    res.json({ ok: true });
  }),
);
