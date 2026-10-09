import { defineConfig } from 'vitest/config';

// Full app inventory, including unexecuted React screens. A green unit suite is not a green UI coverage gate.
export default defineConfig({
  test: {
    include: ['apps/yard-web/src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['apps/yard-web/src/**/*.{ts,tsx}'],
      exclude: ['**/*.test.{ts,tsx}'],
      reportsDirectory: 'artifacts/ui-audit/unit-coverage',
      reporter: ['text', 'json-summary', 'json'],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 98 },
    },
  },
});
