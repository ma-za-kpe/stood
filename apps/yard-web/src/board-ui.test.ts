import { expect, it } from 'vitest';
import { leaseRemaining, nextCard } from './board-ui.js';

it('moves focus across Board cards with arrows, Home and End and ignores other keys (T-0205)', () => {
  expect(nextCard(0, 'ArrowRight', 3)).toBe(1);
  expect(nextCard(2, 'ArrowDown', 3)).toBe(2);
  expect(nextCard(0, 'ArrowLeft', 3)).toBe(0);
  expect(nextCard(2, 'ArrowUp', 3)).toBe(1);
  expect(nextCard(1, 'Home', 3)).toBe(0);
  expect(nextCard(0, 'End', 3)).toBe(2);
  expect(nextCard(0, 'Enter', 3)).toBeNull();
  expect(nextCard(0, 'ArrowRight', 0)).toBeNull();
  expect(nextCard(5, 'ArrowRight', 3)).toBeNull();
});
it('shows the lease countdown in hours and minutes and says when it has ended', () => {
  const now = 1791158400000;
  expect(leaseRemaining(now + 48 * 3600000 - 60000, now)).toBe('47h 59m left on the lease');
  expect(leaseRemaining(now + 5 * 60000, now)).toBe('5m left on the lease');
  expect(leaseRemaining(now, now)).toBe('Lease ended');
  expect(leaseRemaining(Number.NaN, now)).toBe('Lease time unknown');
});
