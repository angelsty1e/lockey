import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';

import { env } from './env.js';
import { logger } from './logger.js';
import { HttpError } from './errors.js';
import { authRouter } from './routes/auth.js';
import { usersRouter } from './routes/users.js';
import { auditRouter } from './routes/audit.js';
import { settingsRouter } from './routes/settings.js';
import { setupRouter } from './routes/setup.js';
import { vaultRouter } from './routes/vault.js';
import { mfaAccountRouter } from './routes/mfaAccount.js';
import { accountRouter } from './routes/account.js';
import { healthcheckRouter } from './routes/healthcheck.js';
import { startHealthcheckCron, stopHealthcheckCron } from './services/healthcheckCron.js';
import { requireCsrfHeader } from './csrf.js';
import { prisma } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.set('trust proxy', env.TRUST_PROXY);
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        // Vite/React injects inline styles at runtime; allowing 'unsafe-inline' for styles only.
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
  }),
);
const allowedOrigins = env.CORS_ORIGIN?.split(',').map((s: string) => s.trim()).filter(Boolean) ?? [];
if (allowedOrigins.length === 0 && env.NODE_ENV === 'production') {
  // F5 — un boot de prod sans CORS_ORIGIN passe sur `origin: false` (CORS désactivé).
  // En général c'est volontaire (frontend servi par le même process), mais on log
  // un warning pour qu'un déploiement multi-origine ne le rate pas en silence.
  logger.warn(
    'CORS_ORIGIN non défini en production — toute requête cross-origin sera refusée. Si le frontend est servi par un autre domaine, configure CORS_ORIGIN.',
  );
}
app.use(
  cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : false,
    credentials: true,
  }),
);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(pinoHttp({ logger, autoLogging: { ignore: req => req.url === '/api/health' } }));

// M1 — clé combinée IP + username pour éviter qu'un attaquant tournant sur
// plusieurs IP locke un admin (par username), ou inversement qu'un attaquant
// derrière un NAT épuise le quota partagé pour des comptes voisins.
// `username` est tiré de `req.body` qui est déjà parsé par express.json().
const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: req => {
    const body = req.body as { username?: unknown } | undefined;
    const username = typeof body?.username === 'string'
      ? body.username.toLowerCase().slice(0, 64)
      : '';
    return `${req.ip ?? 'anon'}|${username}`;
  },
  message: { error: 'too_many_requests', message: 'Trop de tentatives, réessayez dans 15 minutes.' },
});

const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 200,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.use('/api/', apiLimiter);
app.use('/api/', requireCsrfHeader);
app.use('/api/setup', setupRouter);
// loginLimiter couvre POST /api/auth/login ET POST /api/auth/login/mfa
// (le préfixe matche les deux, l'étape 2 hérite donc du throttle anti-bruteforce).
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth', authRouter);
// Routes plus spécifiques en premier : /api/account/mfa avant /api/account.
app.use('/api/account/mfa', mfaAccountRouter);
app.use('/api/account', accountRouter);
app.use('/api/users', usersRouter);
app.use('/api/vault', vaultRouter);
app.use('/api/audit', auditRouter);
// Routes plus spécifiques en premier — Express matche dans l'ordre, donc
// /api/settings/healthcheck doit être enregistré AVANT /api/settings.
app.use('/api/settings/healthcheck', healthcheckRouter);
app.use('/api/settings', settingsRouter);

const clientDist = path.resolve(__dirname, '../../client/dist');
app.use(express.static(clientDist));
app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));

app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.code, message: err.message, details: err.details });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'bad_request', details: err.flatten() });
    return;
  }
  req.log.error({ err }, 'unhandled error');
  res.status(500).json({ error: 'internal_error', message: 'Une erreur interne est survenue.' });
});

// Pré-flight DB : refus de booter si des secrets 2FA sont stockés sans
// VAULT_MASTER_KEY, ou si un smtpPass est stocké sans SMTP_ENCRYPTION_KEY.
// Mieux planter au démarrage que renvoyer des 500 silencieux ensuite.
// (Lockey lui-même est désormais chiffré côté navigateur et
// n'utilise plus VAULT_MASTER_KEY ; seul le 2FA en dépend encore.)
async function preflight(): Promise<void> {
  if (!env.VAULT_MASTER_KEY) {
    const mfaCount = await prisma.user.count({
      where: { OR: [{ mfaSecret: { not: null } }, { mfaPendingSecret: { not: null } }] },
    });
    if (mfaCount > 0) {
      logger.fatal(
        { mfaCount },
        'VAULT_MASTER_KEY est obligatoire : des secrets 2FA sont déjà chiffrés. Démarrage refusé.',
      );
      process.exit(1);
    }
  }

  if (!env.SMTP_ENCRYPTION_KEY) {
    const cfg = await prisma.emailConfig.findUnique({
      where: { id: 'default' },
      select: { smtpPass: true },
    });
    if (cfg?.smtpPass) {
      logger.fatal(
        'SMTP_ENCRYPTION_KEY est obligatoire : un mot de passe SMTP est déjà chiffré en DB (sinon il dépendra de JWT_SECRET et toute rotation cassera le SMTP). Démarrage refusé.',
      );
      process.exit(1);
    }
  }
}

await preflight().catch(err => {
  logger.fatal({ err }, 'preflight failed');
  process.exit(1);
});

const server = app.listen(env.PORT, env.HOST, () => {
  logger.info({ host: env.HOST, port: env.PORT }, 'Lockey listening');
  startHealthcheckCron();
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');
  stopHealthcheckCron();
  server.close(() => {
    logger.info('http server closed');
  });
  try {
    await prisma.$disconnect();
  } catch (err) {
    logger.warn({ err }, 'prisma disconnect failed');
  }
  setTimeout(() => process.exit(0), 50).unref();
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
