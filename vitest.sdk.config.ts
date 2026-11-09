import { defineConfig } from 'vitest/config';

// T-0053: the APIMatic-generated SDK against the real router (scripts/check-sdk builds the SDK first).
export default defineConfig({
  test: {
    include: ['services/**/*.sdk.test.ts'],
    testTimeout: 20000,
    // The real-router harness imports the freshly built SDK before each suite. A clean SDK install
    // can make that setup exceed Vitest's 10-second default even when the tests themselves are fast.
    hookTimeout: 30000,
  },
});
