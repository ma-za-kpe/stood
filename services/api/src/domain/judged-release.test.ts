import { expect, it } from 'vitest';
import { captureFenced } from './judged-release.js';

const code = (id: string) => ({ profileId: 'code.milestone@1', decisions: [{ id }] });
// Owner decision 2026-10-10: releases from the old in-process runner are void for payment.
it('lets a code capture through only on a decision from the judge', () => {
  expect(captureFenced(code('judge:pkg_1'), 'CAPTURE')).toBe(false);
  expect(captureFenced({ ...code('judge-usage:pkg_1'), profileId: 'code.final@1' }, 'CAPTURE')).toBe(false);
  for (const old of ['run:pkg_1', 'usage:pkg_1', '', 'judgex:pkg_1'])
    expect(captureFenced(code(old), 'CAPTURE')).toBe(true);
  expect(captureFenced({ profileId: 'code.milestone@1', decisions: [] }, 'CAPTURE')).toBe(true);
  // A refusal still voids the hold, and other profiles are not code.
  expect(captureFenced(code('run:pkg_1'), 'VOID')).toBe(false);
  expect(captureFenced({ profileId: 'rental.return@1', decisions: [{ id: 'x' }] }, 'CAPTURE')).toBe(false);
});
