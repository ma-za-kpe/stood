import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@stood/api-release-artifact',
    include: ['test/release-artifact.test.ts'],
    sequence: { groupOrder: 1 },
    maxWorkers: 1,
    testTimeout: 360000,
  },
});
