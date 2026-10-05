import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['services/**/*.network.test.ts'], fileParallelism: false, testTimeout: 20000 },
});
