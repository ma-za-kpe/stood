import { defineProject } from 'vitest/config';

export default defineProject({ test: { name: '@stood/yard-domain', include: ['src/**/*.test.ts'] } });
