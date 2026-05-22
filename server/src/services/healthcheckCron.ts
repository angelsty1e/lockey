import { prisma } from '../db.js';
import { logger } from '../logger.js';
import { executeAndPersist } from './healthcheck.js';

/**
 * Cron in-process : tick chaque minute, vérifie si l'heure courante (locale
 * serveur) matche `scheduleHour:scheduleMinute` et si on n'a pas déjà tourné
 * dans la dernière heure (anti double-run sur restart/changement d'heure).
 *
 * Le destinataire du rapport est l'email du premier admin actif (par
 * `createdAt asc` — typiquement le compte admin initial créé par
 * `seed-admin`). Si aucun admin n'a d'email renseigné, le run a quand même
 * lieu mais l'email est skipped (ça reste dans l'historique en DB).
 */

const TICK_MS = 60_000;
const RECENT_RUN_GUARD_MS = 50 * 60_000; // 50 min — évite double-run même si l'horloge bouge

let timer: NodeJS.Timeout | null = null;

async function shouldRunNow(): Promise<boolean> {
  const cfg = await prisma.healthCheckConfig.findUnique({ where: { id: 'default' } });
  if (!cfg || !cfg.scheduleEnabled || cfg.enabledChecks.length === 0) return false;

  const now = new Date();
  if (now.getHours() !== cfg.scheduleHour) return false;
  if (now.getMinutes() !== cfg.scheduleMinute) return false;

  if (cfg.lastRunAt && now.getTime() - cfg.lastRunAt.getTime() < RECENT_RUN_GUARD_MS) {
    return false;
  }
  return true;
}

async function pickRecipient(): Promise<string | null> {
  const admin = await prisma.user.findFirst({
    where: { role: 'ADMIN', active: true, email: { not: null } },
    orderBy: { createdAt: 'asc' },
    select: { email: true },
  });
  return admin?.email ?? null;
}

async function tick(): Promise<void> {
  try {
    if (!(await shouldRunNow())) return;
    const recipientEmail = await pickRecipient();
    logger.info({ recipientEmail }, 'healthcheck: cron tick fires, running checks');
    const result = await executeAndPersist({
      triggeredBy: 'CRON',
      recipientEmail,
    });
    logger.info(
      {
        runId: result.runId,
        checks: result.results.length,
        failCount: result.results.filter(r => !r.ok).length,
        emailSent: result.emailSent,
        emailError: result.emailError,
      },
      'healthcheck: cron run finished',
    );
  } catch (err) {
    // On ne re-throw jamais — le cron doit survivre aux erreurs ponctuelles.
    logger.error({ err }, 'healthcheck: cron tick failed');
  }
}

export function startHealthcheckCron(): void {
  if (timer) return;
  timer = setInterval(() => {
    void tick();
  }, TICK_MS);
  // Pas de unref() — on veut que le process reste vivant pour servir aussi
  // l'API ; le cron est secondaire mais doit tourner tant que l'API tourne.
  logger.info({ intervalMs: TICK_MS }, 'healthcheck cron started');
}

export function stopHealthcheckCron(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
