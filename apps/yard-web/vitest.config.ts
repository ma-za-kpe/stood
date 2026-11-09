import { defineProject } from 'vitest/config';
import { workspaceAliases } from '../../vitest-workspaces.js';

export default defineProject({
  resolve: { alias: workspaceAliases },
  test: {
    name: '@stood/yard-web',
    include: ['src/**/*.test.{ts,tsx}'],
    testTimeout: Number(process.env.STOOD_TEST_TIMEOUT_MS) || 15000,
  },
});
