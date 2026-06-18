import pino from 'pino';
import { env } from './env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'lockey' },
  timestamp: pino.stdTimeFunctions.isoTime,
  // S7 — la liste précédente laissait fuiter authHash, secrets TOTP, mots de
  // passe SMTP et codes de récupération si un handler logguait `req.body`
  // (notamment en LOG_LEVEL=debug). On couvre tous les champs sensibles.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["set-cookie"]',
      '*.password',
      '*.masterPasswordHash',
      '*.authHash',
      '*.recoveryHash',
      '*.recoveryCode',
      '*.recoveryProtectedKey',
      '*.protectedVaultKey',
      '*.code',
      '*.backupCode',
      '*.totp',
      '*.mfaSecret',
      '*.smtpPass',
      '*.secret',
      '*.token',
      '*.mfaToken',
    ],
    censor: '***',
  },
});
