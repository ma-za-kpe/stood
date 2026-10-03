import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['services/**/*.test.ts', 'packages/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['services/api/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/server.ts'],
      reporter: ['text', 'json-summary'],
      thresholds: {
        branches: 85,
        functions: 85,
        lines: 85,
        statements: 85,
        'services/api/src/domain/**': { branches: 100, functions: 100, lines: 100, statements: 100 },
      },
    },
  },
});
