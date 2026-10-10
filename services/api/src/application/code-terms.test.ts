import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { codeTerms } from './code-terms.js';

const sha = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const tests = [
  { id: 't-book', path: 'tests/booking.test.js' },
  { id: 't-pay', path: 'tests/payment.test.js' },
];
const terms = {
  repository: 'buyer/project',
  baseCommit: 'a'.repeat(40),
  testBundleHash: 'b'.repeat(64),
  manifestHash: sha(tests),
  testIds: ['t-book', 't-pay'],
  tests,
};

// T-0159: a code milestone's frozen terms are checked when the buyer's allowance is drafted, so the runner and the
// verifier later bind to exactly what was signed, never to what a package submission claims.
describe('codeTerms', () => {
  it('accepts consistent terms, with the mutation floor defaulting to none', () => {
    expect(codeTerms(terms)).toEqual({ ...terms, minMutation: 0 });
    expect(codeTerms({ ...terms, minMutation: 0.6 }).minMutation).toBe(0.6);
  });

  it('refuses terms that do not match their own manifest, or anything unsafe or unknown', () => {
    for (const bad of [
      { ...terms, repository: 'not a repo' },
      { ...terms, baseCommit: 'main' },
      { ...terms, testBundleHash: 'short' },
      { ...terms, manifestHash: 'c'.repeat(64) },
      { ...terms, testIds: ['t-pay', 't-book'] },
      { ...terms, testIds: ['t-book'] },
      { ...terms, tests: [...tests].reverse(), manifestHash: sha([...tests].reverse()) },
      {
        ...terms,
        tests: [{ id: 't-x', path: '../escape.js' }],
        testIds: ['t-x'],
        manifestHash: sha([{ id: 't-x', path: '../escape.js' }]),
      },
      { ...terms, tests: [tests[0], tests[0]], testIds: ['t-book', 't-book'], manifestHash: sha([tests[0], tests[0]]) },
      { ...terms, tests: [], testIds: [], manifestHash: sha([]) },
      { ...terms, minMutation: 2 },
      { ...terms, extra: 'field' },
      { repository: terms.repository },
    ])
      expect(() => codeTerms(bad)).toThrow('Invalid code terms');
  });
});
