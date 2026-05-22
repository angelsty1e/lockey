import { Router } from 'express';
import { z } from 'zod';
import { AuditAction, type Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth, requireSession, requireAdmin } from '../auth.js';
import { badRequest } from '../errors.js';
import { asyncHandler } from '../asyncHandler.js';

export const auditRouter = Router();

auditRouter.use(requireAuth, requireSession, requireAdmin);

const querySchema = z.object({
  action: z.nativeEnum(AuditAction).optional(),
  userId: z.string().optional(),
  serial: z.string().optional(),
  success: z
    .enum(['true', 'false'])
    .optional()
    .transform(v => (v === undefined ? undefined : v === 'true')),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

auditRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) throw badRequest('paramètres invalides', parsed.error.flatten());
    const { action, userId, serial, success, from, to, limit, offset } = parsed.data;

    const where: Prisma.AuditLogWhereInput = {};
    if (action) where.action = action;
    if (userId) where.userId = userId;
    if (serial) where.serial = serial;
    if (success !== undefined) where.success = success;
    if (from || to) where.createdAt = { gte: from, lte: to };

    const [items, total] = await prisma.$transaction([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: { user: { select: { id: true, username: true } } },
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json({ items, total, limit, offset });
  }),
);
