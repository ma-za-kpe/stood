import { expect, it, vi } from 'vitest';
import { ClaimKeys } from './claim-keys.js';

it('keeps a claim retry key but changes it for a reposted version or another offer', () => {
  let next = 0;
  const random = vi.fn(() => new Uint8Array(16).fill(++next));
  const keys = new ClaimKeys(random);
  const first = keys.for('offer', 3);
  expect(first).toMatch(/^web:[a-f0-9]{32}$/);
  expect(keys.for('offer', 3)).toBe(first);
  expect(random).toHaveBeenCalledTimes(1);
  expect(keys.for('offer', 7)).not.toBe(first);
  expect(keys.for('other', 3)).not.toBe(first);
});
