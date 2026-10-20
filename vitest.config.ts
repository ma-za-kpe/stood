import { defineConfig } from 'vitest/config';

const coverageIncludes = [
  'services/api/src/**/*.ts',
  'services/yard-api/src/**/*.ts',
  'services/yard-foreman/src/**/*.ts',
  'services/simulators/src/**/*.ts',
  'packages/yard-domain/src/**/*.ts',
  'packages/yard-contracts/src/**/*.ts',
  'packages/stood-sdk/src/**/*.ts',
];

export default defineConfig({
  test: {
    // Each pnpm workspace owns its test project. Coverage runs once across the full process.
    projects: [
      'services/*/vitest.config.ts',
      'services/api/vitest.release.config.ts',
      'packages/*/vitest.config.ts',
      'apps/*/vitest.config.ts',
    ],
    coverage: {
      provider: 'v8',
      include: ['apps/yard-web/src/**/*.{ts,tsx}', ...coverageIncludes],
      exclude: [
        '**/*.test.{ts,tsx}',
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
        '**/api/src/live-e2e-cli.ts',
        '**/api/src/allowance-version-e2e-cli.ts',
        '**/adapters/runner/vercel-sdk.ts',
        '**/yard-api/src/server.ts',
        '**/adapters/db-postgres/**',
        'apps/yard-web/src/vite-env.d.ts',
      ],
      reporter: ['text', 'json-summary'],
      thresholds: {
        branches: 85,
        functions: 85,
        lines: 85,
        statements: 85,
        'services/api/src/domain/**': { branches: 100, functions: 100, lines: 100, statements: 100 },
        'packages/yard-domain/src/**': { branches: 100, functions: 100, lines: 100, statements: 100 },
        'apps/yard-web/src/**': { branches: 98, functions: 98, lines: 98, statements: 98 },
      },
    },
  },
});
