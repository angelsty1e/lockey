// Vitest setupFile : pose les variables d'environnement nécessaires AVANT
// que les modules sous test (et leur import en chaîne de `src/env.ts`) ne
// parsent `process.env` au top-level. Sans ça, l'import de `src/env.ts`
// déclenche `process.exit(1)` puisque DATABASE_URL/JWT_SECRET sont absents
// en environnement de test.

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
// Clé de test réaliste : doit passer la validation `strongSecret` de env.ts
// (≥ 12 caractères distincts, pas de placeholder « CHANGE_ME »). Un 'a'.repeat(64)
// serait désormais rejeté (1 seul caractère distinct → entropie nulle).
process.env.JWT_SECRET = 'test-jwt-secret-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ-xyz';
// Clé HMAC dédiée au chaînage d'audit (sinon dérivée de JWT_SECRET par HKDF).
process.env.AUDIT_HMAC_KEY = 'test-audit-hmac-key-0123456789-abcdefghijklmnopqrstuvwxyz';
// Master key arbitraire mais stable — les tests crypto round-trip en dépendent.
process.env.VAULT_MASTER_KEY = 'test-vault-master-key-0123456789-abcdefghij';
// Posée pour que smtpCrypto utilise gcm:v3 (chemin de production préféré).
// Les tests de fallback v1 forgent leur blob manuellement avec JWT_SECRET.
process.env.SMTP_ENCRYPTION_KEY = 'test-smtp-encryption-key-0123456789-abcdefghij';
