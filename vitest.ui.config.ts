import { defineConfig } from 'vitest/config';

// T-0275: the Yard web app's coverage gate. Every app source file is measured (unexecuted screens count as
// zero) by one instrumentation over unit and jsdom component tests, and must reach 98% in all four metrics.
export default defineConfig({
  test: {
    include: ['apps/yard-web/src/**/*.test.{ts,tsx}'],
    // Whole jsdom user flows under coverage instrumentation: 5 seconds timed out in Docker on a busy machine.
    testTimeout: Number(process.env.STOOD_TEST_TIMEOUT_MS) || 15000,
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
