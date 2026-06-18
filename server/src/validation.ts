import { z } from 'zod';

// Matches Prisma cuid() (alnum, ~25 chars). Wide enough to also cover uuid, narrow enough
// to reject path-traversal payloads. Used to validate `req.params.id`.
export const idSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9_-]+$/, 'id invalide');

// ---------- Authentification zéro-connaissance ----------

// `authHash` : base64 d'un PBKDF2-SHA256 (32 octets) calculé côté navigateur (~44 car.).
// S3 — plafonné à 64 caractères : bcrypt ignore silencieusement tout octet au-delà
// du 72e (CWE-916). 64 caractères base64 = 48 octets, on reste sous la limite et
// l'invariant « tout le authHash participe au hash » est garanti.
const authHashField = z.string().min(40).max(64);
// Blob chiffré "lk1:<base64>" — clé de chiffrement Lockey emballée, ~84 caractères.
const cryptoBlob = z.string().min(8).max(2048);
const usernameField = z.string().min(1).max(64);

export const loginSchema = z.object({
  username: usernameField,
  authHash: authHashField,
});

export const setupInitialSchema = z.object({
  username: z.string().min(3).max(64).regex(/^[a-zA-Z0-9._-]+$/, 'caractères autorisés: a-zA-Z0-9._-'),
  email: z.string().email().max(128).optional(),
  authHash: authHashField,
  protectedVaultKey: cryptoBlob,
  recoveryHash: authHashField,
  recoveryProtectedKey: cryptoBlob,
});

export const recoverSchema = z.object({
  username: usernameField,
  recoveryHash: authHashField,
});

// Changement de mot de passe maître : la clé de chiffrement ne change pas, seule
// son enveloppe (protectedVaultKey) et le authHash sont renouvelés.
export const masterPasswordSchema = z.object({
  authHash: authHashField,
  protectedVaultKey: cryptoBlob,
});

// Initialisation de Lockey pour un compte créé par un admin (1re connexion).
export const initVaultSchema = z.object({
  protectedVaultKey: cryptoBlob,
  recoveryHash: authHashField,
  recoveryProtectedKey: cryptoBlob,
});

// Enrôlement d'une passkey (WebAuthn + PRF).
export const passkeySchema = z.object({
  credentialId: z.string().min(1).max(2048),
  prfSalt: z.string().min(8).max(256),
  passkeyProtectedKey: cryptoBlob,
});

export const userCreateSchema = z.object({
  username: z.string().min(3).max(64).regex(/^[a-zA-Z0-9._-]+$/, 'caractères autorisés: a-zA-Z0-9._-'),
  // Le `authHash` est dérivé côté navigateur de l'admin à partir d'un mot de
  // passe temporaire ET du nom du nouvel utilisateur (qui sert de sel).
  authHash: authHashField,
  email: z.string().email().max(128).optional(),
  role: z.enum(['ADMIN', 'USER']).optional(),
});

// L'admin ne peut plus réinitialiser le mot de passe d'un autre utilisateur
// (le chiffrement zéro-connaissance le rendrait impossible à déchiffrer) —
// `password` a été retiré. La récupération passe par le code de récupération.
export const userUpdateSchema = z.object({
  email: z.string().email().max(128).optional().nullable(),
  active: z.boolean().optional(),
  role: z.enum(['ADMIN', 'USER']).optional(),
});

// ---------- Lockey (éléments chiffrés de bout en bout) ----------

const vaultItemType = z.enum(['LOGIN', 'NOTE', 'CARD', 'IDENTITY', 'API_KEY']);
// Blob AES-256-GCM "lk1:<base64>" produit côté navigateur. Large : un élément
// peut contenir une longue note ou une clé API multi-lignes.
const vaultBlob = z.string().min(1).max(200_000);

export const vaultItemCreateSchema = z.object({
  type: vaultItemType,
  favorite: z.boolean().optional(),
  encryptedData: vaultBlob,
});

export const vaultItemUpdateSchema = z.object({
  type: vaultItemType.optional(),
  favorite: z.boolean().optional(),
  encryptedData: vaultBlob.optional(),
});

export type VaultItemCreateInput = z.infer<typeof vaultItemCreateSchema>;
export type VaultItemUpdateInput = z.infer<typeof vaultItemUpdateSchema>;

// ---------- MFA / 2FA ----------

// Le frontend peut envoyer "123456" ou "123 456" — on accepte les espaces et
// tirets, puis on revérifie côté `verifyTotp`.
const totpCode = z
  .string()
  .min(6)
  .max(12)
  .regex(/^[\d\s-]+$/, 'code TOTP invalide');

const backupCode = z
  .string()
  .min(8)
  .max(20)
  .regex(/^[A-Za-z0-9\s-]+$/, 'code de secours invalide');

export const mfaEnableSchema = z.object({
  code: totpCode,
});

export const mfaDisableSchema = z.object({
  // `authHash` zéro-connaissance — preuve de connaissance du mot de passe maître.
  authHash: authHashField,
  code: totpCode,
});

export const mfaRegenerateCodesSchema = z.object({
  code: totpCode,
});

export const mfaLoginVerifySchema = z.object({
  mfaToken: z.string().min(1).max(2048),
  code: totpCode.optional(),
  backupCode: backupCode.optional(),
}).refine(d => !!d.code !== !!d.backupCode, {
  message: 'fournir soit code TOTP soit backupCode (un seul des deux)',
});

// ---------- Healthcheck ----------

export const healthcheckConfigUpdateSchema = z.object({
  enabledChecks: z.array(z.string().min(1).max(64)).max(50),
  scheduleHour: z.number().int().min(0).max(23),
  scheduleMinute: z.number().int().min(0).max(59),
  scheduleEnabled: z.boolean(),
});
