import { z } from 'zod';

/**
 * Valide un secret cryptographique : longueur minimale ET entropie minimale.
 *
 * `z.string().min(32)` ne compte que des *caractères* : "0000…" (32 zéros) ou
 * "CHANGE_ME_CHANGE_ME_CHANGE_ME_AB" passaient alors qu'ils sont triviaux à
 * brute-forcer (F4). On rejette donc :
 *   - les placeholders évidents (CHANGE_ME),
 *   - les valeurs à très faible diversité de caractères (< 12 distincts) qui
 *     trahissent une clé tapée à la main plutôt qu'un `openssl rand`.
 * Une vraie clé aléatoire base64/hex de 32 octets a ~22+ caractères distincts.
 */
function strongSecret(name: string, min = 32) {
  return z
    .string()
    .min(min, `${name} doit faire au moins ${min} caractères`)
    .refine(v => !/change[_-]?me/i.test(v), {
      message: `${name} contient un placeholder — générez-le avec \`openssl rand -base64 32\``,
    })
    .refine(v => new Set(v).size >= 12, {
      message: `${name} a trop peu d'entropie (clé triviale ?) — utilisez \`openssl rand -base64 32\``,
    });
}

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: strongSecret('JWT_SECRET'),
  JWT_EXPIRES_IN: z.string().default('12h'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  CORS_ORIGIN: z.string().optional(),
  TRUST_PROXY: z.string().default('loopback'),
  // Clé HMAC du chaînage du journal d'audit. Détenue HORS de la base : c'est ce
  // qui empêche un attaquant ayant un accès write Postgres de recalculer la
  // chaîne après altération (F1). Optionnelle : à défaut, une clé dédiée est
  // dérivée de JWT_SECRET par HKDF (domain-separated). Une clé propre est
  // préférable pour découpler la rotation de session de l'intégrité d'audit.
  AUDIT_HMAC_KEY: strongSecret('AUDIT_HMAC_KEY').optional(),
  // Dérive la clé AES-256-GCM de chiffrement du mot de passe SMTP au repos.
  // OBLIGATOIRE pour stocker un mot de passe SMTP : l'écriture refuse de tomber
  // sur la clé dérivée de JWT_SECRET (legacy v1, lecture seule) — cf. F3.
  SMTP_ENCRYPTION_KEY: strongSecret('SMTP_ENCRYPTION_KEY').optional(),
  // Master key for the vault module (server credentials at rest, AES-256-GCM).
  // Mandatory if the vault is used. Generate with `openssl rand -base64 32`.
  // Rotating this breaks all stored vault secrets — back them up before changing.
  VAULT_MASTER_KEY: strongSecret('VAULT_MASTER_KEY').optional(),
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
