import { promises as fs, statfsSync } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { prisma } from '../db.js';
import { logger } from '../logger.js';
import { recomputeAuditHash } from '../audit.js';
import { vaultEncrypt, vaultDecrypt, vaultIsConfigured } from '../utils/vaultCrypto.js';
import { sendMail } from './email.js';
import { renderEmail } from './emailTemplate.js';

const execFileP = promisify(execFile);

export type Severity = 'OK' | 'WARN' | 'FAIL';

export interface CheckResult {
  key: string;
  label: string;
  ok: boolean;
  severity: Severity;
  durationMs: number;
  message: string;
}

interface CheckDefinition {
  key: string;
  label: string;
  description: string;
  /** Run le check et retourne ok/severity/message. Throw → traité comme FAIL. */
  runner: () => Promise<{ ok: boolean; severity: Severity; message: string }>;
}

// ============================================================================
// CATALOGUE DES CHECKS
// ============================================================================

const CHECKS: CheckDefinition[] = [
  {
    key: 'db.connection',
    label: 'Base de données — connexion',
    description: 'Vérifie que PostgreSQL répond à un SELECT 1 en moins d\'1 seconde.',
    runner: async () => {
      const t = Date.now();
      await prisma.$queryRaw`SELECT 1`;
      const elapsed = Date.now() - t;
      if (elapsed > 1000) {
        return { ok: true, severity: 'WARN', message: `OK mais lent (${elapsed}ms)` };
      }
      return { ok: true, severity: 'OK', message: `Répondu en ${elapsed}ms` };
    },
  },

  {
    key: 'db.admin_present',
    label: 'Base de données — admin actif',
    description: 'Vérifie qu\'au moins un utilisateur ADMIN actif existe.',
    runner: async () => {
      const count = await prisma.user.count({ where: { role: 'ADMIN', active: true } });
      if (count === 0) return { ok: false, severity: 'FAIL', message: 'Aucun admin actif !' };
      return { ok: true, severity: 'OK', message: `${count} admin(s) actif(s)` };
    },
  },

  {
    key: 'vault.master_key',
    label: 'Lockey — clé maître',
    description: 'Vérifie que VAULT_MASTER_KEY est défini ET déchiffre un canary round-trip.',
    runner: async () => {
      if (!vaultIsConfigured()) {
        return { ok: false, severity: 'FAIL', message: 'VAULT_MASTER_KEY non défini' };
      }
      const canary = `healthcheck-${Date.now()}`;
      const blob = vaultEncrypt(canary);
      const decrypted = vaultDecrypt(blob);
      if (decrypted !== canary) {
        return { ok: false, severity: 'FAIL', message: 'round-trip cassé' };
      }
      return { ok: true, severity: 'OK', message: 'round-trip AES-GCM OK' };
    },
  },

  {
    key: 'audit.chain',
    label: 'Audit log — intégrité de la chaîne',
    description: 'Vérifie la chaîne de hash sur les 1000 derniers événements (mêmes règles que `npm run verify:audit-chain`).',
    runner: async () => {
      const rows = await prisma.auditLog.findMany({
        orderBy: { id: 'asc' },
        take: 1000,
      });
      if (rows.length === 0) {
        return { ok: true, severity: 'OK', message: 'Aucun audit log à vérifier' };
      }
      let lastHash: string | null = null;
      let chainStarted = false;
      let chained = 0;
      for (const row of rows) {
        if (row.hash === null) {
          if (chainStarted) {
            return {
              ok: false,
              severity: 'FAIL',
              message: `Ligne ${row.id} sans hash entre des lignes chaînées`,
            };
          }
          continue;
        }
        const expected = recomputeAuditHash({
          action: row.action,
          userId: row.userId,
          username: row.username,
          ip: row.ip,
          userAgent: row.userAgent,
          serial: row.serial,
          details: row.details,
          success: row.success,
          createdAt: row.createdAt,
          prevHash: row.prevHash,
        });
        if (expected !== row.hash) {
          return {
            ok: false,
            severity: 'FAIL',
            message: `Hash incohérent à l'événement ${row.id}`,
          };
        }
        if (chainStarted && row.prevHash !== lastHash) {
          return {
            ok: false,
            severity: 'FAIL',
            message: `prevHash incohérent à l'événement ${row.id}`,
          };
        }
        lastHash = row.hash;
        chainStarted = true;
        chained++;
      }
      return { ok: true, severity: 'OK', message: `${chained} événement(s) chaîné(s) vérifié(s)` };
    },
  },

  {
    key: 'disk.space',
    label: 'Disque — espace libre',
    description: 'Vérifie qu\'il reste plus de 10% libre sur le filesystem qui héberge l\'application.',
    runner: async () => {
      const stats = statfsSync(process.cwd());
      const totalBytes = Number(stats.blocks) * stats.bsize;
      const freeBytes = Number(stats.bavail) * stats.bsize;
      const freePct = (freeBytes / totalBytes) * 100;
      const freeGB = (freeBytes / 1024 ** 3).toFixed(1);
      if (freePct < 10) {
        return {
          ok: false,
          severity: 'FAIL',
          message: `Espace critique : ${freePct.toFixed(1)}% libre (${freeGB} GB)`,
        };
      }
      if (freePct < 20) {
        return {
          ok: true,
          severity: 'WARN',
          message: `Espace bas : ${freePct.toFixed(1)}% libre (${freeGB} GB)`,
        };
      }
      return {
        ok: true,
        severity: 'OK',
        message: `${freePct.toFixed(1)}% libre (${freeGB} GB)`,
      };
    },
  },

  {
    key: 'frontend.served',
    label: 'Frontend — bundle servi',
    description: 'Vérifie que client/dist/index.html existe (sinon le SPA est cassé).',
    runner: async () => {
      const indexHtml = path.resolve(process.cwd(), '../client/dist/index.html');
      try {
        const stat = await fs.stat(indexHtml);
        const ageDays = Math.floor((Date.now() - stat.mtime.getTime()) / (1000 * 60 * 60 * 24));
        return {
          ok: true,
          severity: 'OK',
          message: `index.html présent (build il y a ${ageDays}j)`,
        };
      } catch {
        return {
          ok: false,
          severity: 'FAIL',
          message: `client/dist/index.html absent — relancer le build front`,
        };
      }
    },
  },

  {
    key: 'smtp.ready',
    label: 'SMTP — configuration prête',
    description: 'Vérifie que la configuration SMTP est complète (sans envoyer de mail).',
    runner: async () => {
      const cfg = await prisma.emailConfig.findUnique({ where: { id: 'default' } });
      if (!cfg) return { ok: false, severity: 'FAIL', message: 'Aucune config SMTP' };
      if (!cfg.smtpHost || !cfg.smtpUser || !cfg.smtpPass || !cfg.fromEmail) {
        return { ok: false, severity: 'FAIL', message: 'Configuration SMTP incomplète' };
      }
      return {
        ok: true,
        severity: 'OK',
        message: `Hôte ${cfg.smtpHost}:${cfg.smtpPort}, expéditeur ${cfg.fromEmail}`,
      };
    },
  },

  {
    key: 'tests.vitest',
    label: 'Tests unitaires (Vitest)',
    description:
      'Lance la suite de tests Vitest en sous-process et reporte pass/fail. Peut prendre 10-30s selon la taille de la suite.',
    runner: async () => {
      // Vitest est en devDependencies — si l'install prod a skip les devDeps,
      // le binaire n'est pas dispo. On retourne WARN (informatif) plutôt que FAIL.
      type ExecError = Error & { stdout?: string; killed?: boolean; code?: string | number };
      try {
        const { stdout } = await execFileP(
          'npx',
          ['--no-install', 'vitest', 'run', '--reporter=json'],
          {
            timeout: 60_000,
            maxBuffer: 10 * 1024 * 1024,
            cwd: process.cwd(), // server/ quand systemd démarre depuis WorkingDirectory
          },
        );
        const result = JSON.parse(stdout) as {
          numTotalTests?: number;
          numPassedTests?: number;
          numFailedTests?: number;
        };
        const total = result.numTotalTests ?? 0;
        const failed = result.numFailedTests ?? 0;
        const passed = result.numPassedTests ?? 0;
        if (failed > 0) {
          return {
            ok: false,
            severity: 'FAIL',
            message: `${failed}/${total} tests en échec (${passed} passent)`,
          };
        }
        if (total === 0) {
          return { ok: true, severity: 'WARN', message: 'Aucun test trouvé' };
        }
        return { ok: true, severity: 'OK', message: `${total} tests passent` };
      } catch (err) {
        const e = err as ExecError;
        // Vitest exit non-zero quand des tests fail mais émet quand même le JSON
        // sur stdout — on essaie de le parser pour distinguer "tests qui fail"
        // d'une erreur de lancement.
        if (e.stdout) {
          try {
            const result = JSON.parse(e.stdout) as {
              numTotalTests?: number;
              numPassedTests?: number;
              numFailedTests?: number;
            };
            const total = result.numTotalTests ?? 0;
            const failed = result.numFailedTests ?? 0;
            const passed = result.numPassedTests ?? 0;
            return {
              ok: false,
              severity: 'FAIL',
              message: `${failed}/${total} tests en échec (${passed} passent)`,
            };
          } catch {
            /* tombe dans la branche "erreur de lancement" */
          }
        }
        if (e.killed) {
          return { ok: false, severity: 'FAIL', message: 'Timeout (>60s)' };
        }
        const msg = e.message ? e.message.slice(0, 200) : 'erreur inconnue';
        return {
          ok: true,
          severity: 'WARN',
          message: `Vitest non lançable : ${msg}`,
        };
      }
    },
  },
];

export const HEALTHCHECK_KEYS = CHECKS.map(c => c.key);

export function getHealthcheckCatalog() {
  return CHECKS.map(({ key, label, description }) => ({ key, label, description }));
}

// ============================================================================
// EXECUTION
// ============================================================================

/** Exécute les checks dont la `key` est dans `keys` (parallèle, indépendants). */
export async function runChecks(keys: string[]): Promise<CheckResult[]> {
  const set = new Set(keys);
  const tasks = CHECKS.filter(c => set.has(c.key)).map(async (c): Promise<CheckResult> => {
    const t = Date.now();
    try {
      const res = await c.runner();
      return {
        key: c.key,
        label: c.label,
        ok: res.ok,
        severity: res.severity,
        durationMs: Date.now() - t,
        message: res.message,
      };
    } catch (err) {
      return {
        key: c.key,
        label: c.label,
        ok: false,
        severity: 'FAIL',
        durationMs: Date.now() - t,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  });
  return Promise.all(tasks);
}

// ============================================================================
// RAPPORT EMAIL
// ============================================================================

const SEV_EMOJI: Record<Severity, string> = {
  OK: '✓',
  WARN: '⚠',
  FAIL: '✗',
};

function buildReportHtml(results: CheckResult[]): string {
  const failCount = results.filter(r => !r.ok).length;
  const warnCount = results.filter(r => r.ok && r.severity === 'WARN').length;
  const okCount = results.filter(r => r.ok && r.severity === 'OK').length;

  // `renderEmail` accepte cyan|green|amber|red — pas de "gold".
  const accent: 'green' | 'amber' | 'red' = failCount > 0 ? 'red' : warnCount > 0 ? 'amber' : 'green';
  const heading = failCount > 0
    ? `${failCount} check(s) en échec`
    : warnCount > 0
      ? `${warnCount} avertissement(s)`
      : 'Tous les checks sont au vert';

  const rows = results.map(r => ({
    label: `${SEV_EMOJI[r.severity]} ${r.label}`,
    value: r.message + (r.durationMs > 100 ? ` (${r.durationMs}ms)` : ''),
  }));

  return renderEmail({
    heading,
    subheading: `${okCount} OK · ${warnCount} WARN · ${failCount} FAIL`,
    accent,
    introHtml:
      `<p style="margin:0 0 12px;">Bonjour,</p>` +
      `<p style="margin:0;">Rapport de santé quotidien de votre instance <strong>Lockey</strong>.</p>`,
    rows,
    footnoteHtml:
      `Ce rapport est envoyé automatiquement chaque jour à l'heure configurée dans ` +
      `Paramètres → Tests automatisés. Pour modifier la liste des checks ou ` +
      `désactiver l'envoi, connectez-vous à l'interface.`,
  });
}

function buildReportText(results: CheckResult[]): string {
  const lines: string[] = ['Rapport healthcheck Lockey', '==========================', ''];
  for (const r of results) {
    lines.push(`[${r.severity.padEnd(4)}] ${r.label}`);
    lines.push(`         ${r.message} (${r.durationMs}ms)`);
  }
  return lines.join('\n');
}

/** Persiste un run et envoie le rapport email si un destinataire est fourni. */
export async function executeAndPersist(opts: {
  triggeredBy: 'CRON' | 'MANUAL';
  triggeredById?: string;
  recipientEmail?: string | null;
}): Promise<{ runId: string; results: CheckResult[]; emailSent: boolean; emailError: string | null }> {
  const cfg = await prisma.healthCheckConfig.findUnique({ where: { id: 'default' } });
  if (!cfg) throw new Error('Configuration healthcheck absente');

  const startedAt = new Date();
  const results = await runChecks(cfg.enabledChecks);
  const okCount = results.filter(r => r.ok).length;
  const failCount = results.filter(r => !r.ok).length;
  const allOk = failCount === 0;

  let emailSent = false;
  let emailError: string | null = null;
  if (opts.recipientEmail && results.length > 0) {
    try {
      await sendMail({
        to: opts.recipientEmail,
        subject: `Lockey — Rapport healthcheck (${okCount} OK / ${failCount} FAIL)`,
        text: buildReportText(results),
        html: buildReportHtml(results),
      });
      emailSent = true;
    } catch (err) {
      emailError = err instanceof Error ? err.message : String(err);
      logger.warn({ err }, 'healthcheck email failed');
    }
  }

  const finishedAt = new Date();
  const run = await prisma.healthCheckRun.create({
    data: {
      startedAt,
      finishedAt,
      triggeredBy: opts.triggeredBy,
      triggeredById: opts.triggeredById ?? null,
      ok: allOk,
      okCount,
      failCount,
      results: results as object,
      recipientEmail: opts.recipientEmail ?? null,
      emailSent,
      emailError,
    },
  });

  await prisma.healthCheckConfig.update({
    where: { id: 'default' },
    data: { lastRunAt: startedAt },
  });

  // Purge : garde les 100 derniers runs.
  const old = await prisma.healthCheckRun.findMany({
    orderBy: { startedAt: 'desc' },
    skip: 100,
    select: { id: true },
  });
  if (old.length > 0) {
    await prisma.healthCheckRun.deleteMany({ where: { id: { in: old.map((o: { id: string }) => o.id) } } });
  }

  return { runId: run.id, results, emailSent, emailError };
}
