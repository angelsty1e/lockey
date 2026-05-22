import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET doit faire au moins 32 caractères'),
  JWT_EXPIRES_IN: z.string().default('12h'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  CORS_ORIGIN: z.string().optional(),
  TRUST_PROXY: z.string().default('loopback'),
  // Used to derive the AES-256-GCM key for SMTP password encryption at rest.
  // If unset, falls back to JWT_SECRET-derived key (legacy, gcm:v1) — rotating
  // JWT_SECRET breaks SMTP. Set this to make SMTP storage independent.
  SMTP_ENCRYPTION_KEY: z.string().min(32).optional(),
  // Master key for the vault module (server credentials at rest, AES-256-GCM).
  // Mandatory if the vault is used. Generate with `openssl rand -base64 32`.
  // Rotating this breaks all stored vault secrets — back them up before changing.
  VAULT_MASTER_KEY: z.string().min(32, 'VAULT_MASTER_KEY doit faire au moins 32 caractères').optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('[env] configuration invalide:');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;
