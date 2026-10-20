import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@stood/provider-simulators',
    include: ['src/**/*.test.ts'],
    testTimeout: Number(process.env.STOOD_TEST_TIMEOUT_MS) || 5000,
  },
});
