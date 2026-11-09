import { defineProject } from 'vitest/config';
import { workspaceAliases } from '../../vitest-workspaces.js';

export default defineProject({
  resolve: { alias: workspaceAliases },
  test: {
    name: '@stood/api',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    exclude: ['**/*.db.test.ts', '**/*.network.test.ts', '**/*.sdk.test.ts', 'test/release-artifact.test.ts'],
    testTimeout: Number(process.env.STOOD_TEST_TIMEOUT_MS) || 5000,
  },
});
