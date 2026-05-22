import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, requireSession, requireAdmin } from '../auth.js';
import { badRequest } from '../errors.js';
import { logAudit } from '../audit.js';
import { asyncHandler } from '../asyncHandler.js';
import { encryptSmtpPass } from '../utils/smtpCrypto.js';
import { getEmailConfig, SINGLETON_ID, verifyAndSendTest } from '../services/email.js';

export const settingsRouter = Router();

settingsRouter.use(requireAuth, requireSession, requireAdmin);

const emailUpdateSchema = z.object({
  smtpHost: z.string().max(255).nullable().optional(),
  smtpPort: z.coerce.number().int().min(1).max(65535).optional(),
  smtpSecure: z.boolean().optional(),
  smtpUser: z.string().max(255).nullable().optional(),
  smtpPass: z.string().max(512).optional(), // empty string = leave unchanged
  fromEmail: z.string().email().max(255).nullable().optional(),
  fromName: z.string().max(128).nullable().optional(),
  enabled: z.boolean().optional(),
});

const testSchema = z.object({
  testEmail: z.string().email().optional(),
});

function publicView(c: Awaited<ReturnType<typeof getEmailConfig>>) {
  const { smtpPass, ...rest } = c;
  return { ...rest, hasSmtpPass: !!smtpPass };
}

settingsRouter.get(
  '/email',
  asyncHandler(async (_req, res) => {
    const config = await getEmailConfig();
    res.json(publicView(config));
  }),
);

settingsRouter.put(
  '/email',
  asyncHandler(async (req, res) => {
    const parsed = emailUpdateSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('payload invalide', parsed.error.flatten());

    const data: Record<string, unknown> = {};
    const fields = ['smtpHost', 'smtpPort', 'smtpSecure', 'smtpUser', 'fromEmail', 'fromName', 'enabled'] as const;
    for (const k of fields) {
      if (parsed.data[k] !== undefined) data[k] = parsed.data[k];
    }
    // Don't overwrite the encrypted password if the field is empty
    if (parsed.data.smtpPass !== undefined && parsed.data.smtpPass !== '') {
      data.smtpPass = encryptSmtpPass(parsed.data.smtpPass);
    }

    const updated = await prisma.emailConfig.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID, ...data },
      update: data,
    });

    await logAudit({
      action: 'SETTINGS_UPDATED',
      req,
      details: { section: 'email', fields: Object.keys(data) },
    });

    res.json(publicView(updated));
  }),
);

settingsRouter.post(
  '/email/test',
  asyncHandler(async (req, res) => {
    const parsed = testSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest('payload invalide', parsed.error.flatten());

    const config = await getEmailConfig();
    const target = parsed.data.testEmail || config.fromEmail || '';
    if (!target) {
      throw badRequest("Aucune adresse de destination disponible (renseignez d'abord 'Expéditeur' ou fournissez 'testEmail').");
    }

    try {
      const { messageId } = await verifyAndSendTest(target);
      await logAudit({ action: 'SETTINGS_TEST_SENT', req, details: { to: target, messageId } });
      res.json({ success: true, message: `Email de test envoyé à ${target}`, messageId });
    } catch (err: any) {
      await logAudit({
        action: 'SETTINGS_TEST_SENT',
        req,
        success: false,
        details: { to: target, error: err?.message?.slice(0, 200) },
      });
      res.status(400).json({ success: false, message: err?.message || 'Échec de l\'envoi du test SMTP' });
    }
  }),
);
