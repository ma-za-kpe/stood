import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Slow shared builders (Render's image build) need more than the 5 s default; CI and local keep it.
    testTimeout: Number(process.env.STOOD_TEST_TIMEOUT_MS) || 5000,
    include: ['services/**/*.test.ts', 'packages/**/*.test.ts', 'apps/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.db.test.ts', '**/*.network.test.ts'],
    coverage: {
      provider: 'v8',
      include: [
        'services/api/src/**/*.ts',
        'apps/yard-web/src/project-state.ts',
        'services/yard-api/src/**/*.ts',
        'services/yard-foreman/src/**/*.ts',
        'services/simulators/src/**/*.ts',
        'packages/yard-domain/src/**/*.ts',
        'packages/yard-contracts/src/**/*.ts',
        'packages/stood-sdk/src/**/*.ts',
      ],
      exclude: [
        '**/*.test.ts',
        '**/server.ts',
        '**/setup-cli.ts',
        '**/reconcile-cli.ts',
        '**/sandbox-run-cli.ts',
        '**/migrate-cli.ts',
        '**/findings-cli.ts',
        '**/vault-keys-cli.ts',
        '**/yard-api/src/db-cli.ts',
        '**/yard-api/src/github-check-cli.ts',
        '**/yard-api/src/preview-check-cli.ts',
        '**/api/src/runner-check-cli.ts',
        '**/api/src/evidence-check-cli.ts',
        '**/api/src/openapi-cli.ts',
        '**/adapters/runner/vercel-sdk.ts',
        '**/yard-api/src/server.ts',
        '**/adapters/db-postgres/**',
      ],
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
