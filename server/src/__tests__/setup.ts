// Vitest setupFile : pose les variables d'environnement nécessaires AVANT
// que les modules sous test (et leur import en chaîne de `src/env.ts`) ne
// parsent `process.env` au top-level. Sans ça, l'import de `src/env.ts`
// déclenche `process.exit(1)` puisque DATABASE_URL/JWT_SECRET sont absents
// en environnement de test.

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.JWT_SECRET = 'a'.repeat(64);
// Master key arbitraire mais stable — les tests crypto round-trip en dépendent.
// 32+ caractères pour passer le z.string().min(32).
process.env.VAULT_MASTER_KEY = 'test-vault-master-key-0123456789-abcdefghij';
// Posée pour que smtpCrypto utilise gcm:v3 (chemin de production préféré).
// Les tests de fallback v1 forgent leur blob manuellement avec JWT_SECRET.
process.env.SMTP_ENCRYPTION_KEY = 'test-smtp-encryption-key-0123456789-abcdefghij';
