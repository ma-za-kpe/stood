import { defineProject } from 'vitest/config';

export default defineProject({ test: { name: '@stood/yard-contracts', include: ['src/**/*.test.ts'] } });
