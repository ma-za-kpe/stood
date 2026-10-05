import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['services/**/*.test.ts', 'packages/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.db.test.ts', '**/*.network.test.ts'],
    coverage: {
      provider: 'v8',
      include: [
        'services/api/src/**/*.ts',
        'services/yard-api/src/**/*.ts',
        'services/simulators/src/**/*.ts',
        'packages/yard-domain/src/**/*.ts',
        'packages/stood-sdk/src/**/*.ts',
      ],
      exclude: ['**/*.test.ts', '**/server.ts', '**/setup-cli.ts', '**/reconcile-cli.ts', '**/adapters/db-postgres/**'],
      reporter: ['text', 'json-summary'],
      thresholds: {
        branches: 85,
        functions: 85,
        lines: 85,
        statements: 85,
        'services/api/src/domain/**': { branches: 100, functions: 100, lines: 100, statements: 100 },
        'packages/yard-domain/src/**': { branches: 100, functions: 100, lines: 100, statements: 100 },
      },
    },
  },
});
