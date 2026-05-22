import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Set process.env (VAULT_MASTER_KEY, JWT_SECRET, …) avant le premier import
    // de src/env.ts qui parse process.env à l'import.
    setupFiles: ['./src/__tests__/setup.ts'],
    // bcrypt(10) × 8 = ~1s par appel à generateBackupCodes — laisser de la marge.
    testTimeout: 10_000,
  },
});
