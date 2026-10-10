import { defineConfig } from 'vitest/config';

// T-0053: the APIMatic-generated SDK against the real router (scripts/check-sdk builds the SDK first).
export default defineConfig({ test: { include: ['services/**/*.sdk.test.ts'], testTimeout: 20000 } });
