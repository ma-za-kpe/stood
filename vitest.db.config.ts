import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['services/**/*.db.test.ts'],
    testTimeout: 10000,
    coverage: {
      provider: 'v8',
      include: ['services/api/src/adapters/db-postgres/**/*.ts'],
      exclude: ['**/*.test.ts'],
      reportsDirectory: 'coverage/db',
      reporter: ['text', 'json-summary'],
      thresholds: { branches: 85, functions: 85, lines: 85, statements: 85 },
    },
  },
});
