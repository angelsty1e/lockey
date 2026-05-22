import { Router } from 'express';
import { prisma } from '../db.js';
import { requireAuth, requireSession } from '../auth.js';
import { vaultItemCreateSchema, vaultItemUpdateSchema, idSchema } from '../validation.js';
import { badRequest, forbidden, notFound } from '../errors.js';
import { asyncHandler } from '../asyncHandler.js';
import { logAudit } from '../audit.js';

/**
 * Lockey — stockage zéro-connaissance.
 *
 * Le serveur ne fait que stocker et restituer des blobs chiffrés
 * (`encryptedData`) produits et déchiffrés exclusivement dans le navigateur
 * avec la clé de chiffrement de l'utilisateur. Il n'a jamais accès au contenu :
 * pas de chiffrement côté serveur, pas d'endpoint de « révélation ».
 */
export const vaultRouter = Router();

vaultRouter.use(requireAuth, requireSession);

const itemSelect = {
  id: true,
  type: true,
  favorite: true,
  encryptedData: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** GET /items — tous les éléments stockés par l'utilisateur courant. */
vaultRouter.get(
  '/items',
  asyncHandler(async (req, res) => {
    const items = await prisma.vaultItem.findMany({
      where: { ownerId: req.user!.id },
      select: itemSelect,
      orderBy: { updatedAt: 'desc' },
    });
    res.json(items);
  }),
);

/** POST /items — crée un élément (blob chiffré fourni par le client). */
vaultRouter.post(
  '/items',
  asyncHandler(async (req, res) => {
    const parsed = vaultItemCreateSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('payload invalide', parsed.error.flatten());

    const created = await prisma.vaultItem.create({
      data: {
        ownerId: req.user!.id,
        type: parsed.data.type,
        favorite: parsed.data.favorite ?? false,
        encryptedData: parsed.data.encryptedData,
      },
      select: itemSelect,
    });

    await logAudit({
      action: 'VAULT_ITEM_CREATED',
      req,
      details: { itemId: created.id, type: created.type },
    });

    res.status(201).json(created);
  }),
);

/** PATCH /items/:id — met à jour un élément possédé par l'utilisateur. */
vaultRouter.patch(
  '/items/:id',
  asyncHandler(async (req, res) => {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) throw badRequest('id invalide');
    const parsed = vaultItemUpdateSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('payload invalide', parsed.error.flatten());

    const target = await prisma.vaultItem.findUnique({ where: { id: idParsed.data } });
    if (!target) throw notFound('élément introuvable');
    if (target.ownerId !== req.user!.id) throw forbidden('non autorisé');

    const data: Record<string, unknown> = {};
    if (parsed.data.type !== undefined) data.type = parsed.data.type;
    if (parsed.data.favorite !== undefined) data.favorite = parsed.data.favorite;
    if (parsed.data.encryptedData !== undefined) data.encryptedData = parsed.data.encryptedData;

    const updated = await prisma.vaultItem.update({
      where: { id: target.id },
      data,
      select: itemSelect,
    });

    await logAudit({
      action: 'VAULT_ITEM_UPDATED',
      req,
      details: { itemId: target.id, fields: Object.keys(data) },
    });

    res.json(updated);
  }),
);

/** DELETE /items/:id — supprime un élément possédé par l'utilisateur. */
vaultRouter.delete(
  '/items/:id',
  asyncHandler(async (req, res) => {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) throw badRequest('id invalide');

    const target = await prisma.vaultItem.findUnique({ where: { id: idParsed.data } });
    if (!target) throw notFound('élément introuvable');
    if (target.ownerId !== req.user!.id) throw forbidden('non autorisé');

    await prisma.vaultItem.delete({ where: { id: target.id } });

    await logAudit({
      action: 'VAULT_ITEM_DELETED',
      req,
      details: { itemId: target.id, type: target.type },
    });

    res.json({ ok: true });
  }),
);
