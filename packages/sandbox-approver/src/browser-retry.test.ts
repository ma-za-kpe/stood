import { expect, it } from 'vitest';
import { retryDelay } from './browser-retry.js';

const wall = Date.parse('2026-10-12T00:00:00Z');
it('honours seconds and HTTP dates as minimum waits', () => {
  expect(retryDelay(0, '3', wall, 120000, 0)).toBe(3000);
  expect(retryDelay(0, 'Mon, 12 Oct 2026 00:00:05 GMT', wall, 120000, 0)).toBe(5000);
  expect(retryDelay(0, '0', wall, 120000, 0)).toBe(500);
  expect(retryDelay(0, 'Mon, 12 Oct 2026 00:00:00 GMT', wall, 120000, 0)).toBe(500);
});
it('uses capped exponential backoff with jitter when hints are missing or invalid', () => {
  for (const hint of [null, '', '-1', '1.5', 'invalid', 'Infinity'])
    expect(retryDelay(0, hint, wall, 120000, 0)).toBe(500);
  expect(retryDelay(1, null, wall, 120000, 0)).toBe(1000);
  expect(retryDelay(2, null, wall, 120000, 1)).toBe(4000);
  expect(retryDelay(10, null, wall, 120000, 1)).toBe(30000);
});
it('does not shorten a server wait to fit the remaining budget', () => {
  expect(retryDelay(0, '120', wall, 120000, 0)).toBeNull();
  expect(retryDelay(0, '9'.repeat(400), wall, 120000, 0)).toBeNull();
  expect(retryDelay(0, 'Mon, 12 Oct 2026 01:00:00 GMT', wall, 120000, 0)).toBeNull();
  expect(retryDelay(0, null, wall, 400, 0)).toBeNull();
});
