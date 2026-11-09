import { defineProject } from 'vitest/config';

export default defineProject({ test: { name: '@stood/sandbox-approver', include: ['src/**/*.test.ts'] } });
