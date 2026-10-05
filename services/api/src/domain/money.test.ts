import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Money } from './money.js';

describe('Money (FR-04, NFR-04)', () => {
  it('keeps integer minor units and currency immutable', () => {
    const money = new Money(400000n, 'GBP');
    expect(money.minor).toBe(400000n);
    expect(money.currency).toBe('GBP');
    expect(Object.isFrozen(money)).toBe(true);
    expect(money.toJSON()).toEqual({ minor: 400000, currency: 'GBP' });
  });
  it('accepts zero and the largest exact wire amount', () => {
    expect(new Money(0n, 'USD').toJSON().minor).toBe(0);
    expect(new Money(BigInt(Number.MAX_SAFE_INTEGER), 'EUR').toJSON().minor).toBe(Number.MAX_SAFE_INTEGER);
  });
  it.each([-1n, BigInt(Number.MAX_SAFE_INTEGER) + 1n])('rejects invalid amount %s', (minor) => {
    expect(() => new Money(minor, 'GBP')).toThrow();
  });
  it.each(['', 'gbp', 'ZZZ', 'GB', 'GBPP'])('rejects unsupported currency %s', (currency) => {
    expect(() => new Money(1n, currency)).toThrow();
  });
  it('rejects runtime number inputs, including integers and fractions', () => {
    for (const minor of [1, 0.1, Number.NaN]) {
      expect(() => new Money(minor as unknown as bigint, 'GBP')).toThrow();
    }
  });
  it('never changes currency implicitly', () => {
    const pounds = new Money(100n, 'GBP');
    const dollars = new Money(100n, 'USD');
    expect(() => pounds.add(dollars)).toThrow();
    expect(() => pounds.subtract(dollars)).toThrow();
  });
  it('rejects negative results and overflow', () => {
    expect(() => new Money(1n, 'GBP').subtract(new Money(2n, 'GBP'))).toThrow(
      'Subtraction would produce a negative amount',
    );
    expect(() => new Money(BigInt(Number.MAX_SAFE_INTEGER), 'GBP').add(new Money(1n, 'GBP'))).toThrow();
  });
  it('adds exactly, commutatively, without mutating either input', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 100000000000n }), fc.bigInt({ min: 0n, max: 100000000000n }), (a, b) => {
        const left = new Money(a, 'GHS');
        const right = new Money(b, 'GHS');
        expect(left.add(right).minor).toBe(a + b);
        expect(left.add(right).minor).toBe(right.add(left).minor);
        expect(left.add(right).subtract(right).minor).toBe(a);
        expect(left.minor).toBe(a);
        expect(right.minor).toBe(b);
      }),
    );
  });
});
