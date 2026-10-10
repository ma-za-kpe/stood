import { createHash } from 'node:crypto';

// T-0159: valid frozen terms for a code milestone, for tests that need one. Stood checks these at draft time.
const tests = [{ id: 'works', path: 'tests/works.test.js' }];
export const codeParams = Object.freeze({
  repository: 'buyer/project',
  baseCommit: 'a'.repeat(40),
  testBundleHash: 'b'.repeat(64),
  manifestHash: createHash('sha256').update(JSON.stringify(tests)).digest('hex'),
  testIds: ['works'],
  tests,
});
