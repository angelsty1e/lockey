import { Router } from 'express';
import { prisma } from '../db.js';
import { requireAuth, requireSession, requireAdmin } from '../auth.js';
import { asyncHandler } from '../asyncHandler.js';
import { badRequest, notFound } from '../errors.js';
import { logAudit } from '../audit.js';
import { healthcheckConfigUpdateSchema } from '../validation.js';
import {
  HEALTHCHECK_KEYS,
  executeAndPersist,
  getHealthcheckCatalog,
} from '../services/healthcheck.js';

export const healthcheckRouter = Router();

// Toutes les opérations healthcheck sont admin-only (config globale).
healthcheckRouter.use(requireAuth, requireSession, requireAdmin);

async function ensureConfig() {
  let cfg = await prisma.healthCheckConfig.findUnique({ where: { id: 'default' } });
  if (!cfg) {
    cfg = await prisma.healthCheckConfig.create({
      data: { id: 'default', enabledChecks: HEALTHCHECK_KEYS },
    });
  }
  return cfg;
}

/** GET /catalog — liste statique des checks disponibles. */
healthcheckRouter.get(
  '/catalog',
  asyncHandler(async (_req, res) => {
    res.json({ checks: getHealthcheckCatalog() });
  }),
);

/** GET /config — config courante + dernier run (résumé). */
healthcheckRouter.get(
  '/config',
  asyncHandler(async (_req, res) => {
    const cfg = await ensureConfig();
    const lastRun = await prisma.healthCheckRun.findFirst({
      orderBy: { startedAt: 'desc' },
      select: {
        id: true,
        startedAt: true,
        finishedAt: true,
        triggeredBy: true,
        ok: true,
        okCount: true,
        failCount: true,
        emailSent: true,
        emailError: true,
        recipientEmail: true,
      },
    });
    res.json({
      config: {
        enabledChecks: cfg.enabledChecks,
        scheduleHour: cfg.scheduleHour,
        scheduleMinute: cfg.scheduleMinute,
        scheduleEnabled: cfg.scheduleEnabled,
        lastRunAt: cfg.lastRunAt,
      },
      lastRun,
    });
  }),
);

/** PUT /config — met à jour la config (validations Zod + drop des keys inconnues). */
healthcheckRouter.put(
  '/config',
  asyncHandler(async (req, res) => {
    const parsed = healthcheckConfigUpdateSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('payload invalide', parsed.error.flatten());
    // Filtre les clés qui ne sont plus dans le catalogue (cas après upgrade qui retire un check).
    const knownKeys = new Set(HEALTHCHECK_KEYS);
    const filtered = parsed.data.enabledChecks.filter(k => knownKeys.has(k));

    await ensureConfig();
    const updated = await prisma.healthCheckConfig.update({
      where: { id: 'default' },
      data: {
        enabledChecks: filtered,
        scheduleHour: parsed.data.scheduleHour,
        scheduleMinute: parsed.data.scheduleMinute,
        scheduleEnabled: parsed.data.scheduleEnabled,
      },
    });
    await logAudit({
      action: 'HEALTHCHECK_CONFIG_UPDATED',
      req,
      details: {
        enabledChecks: filtered,
        scheduleHour: parsed.data.scheduleHour,
        scheduleMinute: parsed.data.scheduleMinute,
        scheduleEnabled: parsed.data.scheduleEnabled,
      },
    });
    res.json({
      enabledChecks: updated.enabledChecks,
      scheduleHour: updated.scheduleHour,
      scheduleMinute: updated.scheduleMinute,
      scheduleEnabled: updated.scheduleEnabled,
      lastRunAt: updated.lastRunAt,
    });
  }),
);

/**
 * POST /run — lance manuellement, envoie l'email à l'admin courant si son
 * compte a un email renseigné. Retourne les résultats inline.
 */
healthcheckRouter.post(
  '/run',
  asyncHandler(async (req, res) => {
    await ensureConfig();
    const me = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { email: true },
    });
    const result = await executeAndPersist({
      triggeredBy: 'MANUAL',
      triggeredById: req.user!.id,
      recipientEmail: me?.email ?? null,
    });
    await logAudit({
      action: 'HEALTHCHECK_RUN',
      req,
      details: {
        runId: result.runId,
        okCount: result.results.filter(r => r.ok).length,
        failCount: result.results.filter(r => !r.ok).length,
        emailSent: result.emailSent,
      },
    });
    res.json(result);
  }),
);

/** GET /history?limit=20 — runs précédents (résumé sans `results`). */
healthcheckRouter.get(
  '/history',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '20'), 10) || 20, 1), 100);
    const runs = await prisma.healthCheckRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        startedAt: true,
        finishedAt: true,
        triggeredBy: true,
        ok: true,
        okCount: true,
        failCount: true,
        emailSent: true,
        emailError: true,
      },
    });
    res.json({ runs });
  }),
);

/** GET /history/:id — détail d'un run avec ses results. */
healthcheckRouter.get(
  '/history/:id',
  asyncHandler(async (req, res) => {
    const run = await prisma.healthCheckRun.findUnique({ where: { id: req.params.id } });
    if (!run) throw notFound('run introuvable');
    res.json(run);
  }),
);
