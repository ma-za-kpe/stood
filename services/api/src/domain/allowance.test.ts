import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Allowance, type AllowanceInput } from './allowance.js';
import { Money } from './money.js';
import { Tranche } from './tranche.js';

const draft = (currency = 'GBP'): AllowanceInput => ({
  id: 'alw_fixture',
  platformId: 'platform_fixture',
  payeeRef: 'merchant_fixture',
  cap: new Money(300n, currency),
  milestones: [
    { name: 'Foundation', amount: new Money(100n, currency), profileId: 'construction.stage@1' },
    { name: 'Roof', amount: new Money(200n, currency), profileId: 'construction.stage@1' },
  ],
  windowDays: 28,
  maxResubmits: 2,
});
describe('Allowance creation and hold currency policy (T-0128)', () => {
  it.each(['GBP', 'USD', 'EUR'])('accepts %s and preserves the cap exactly', (currency) => {
    const allowance = new Allowance(draft(currency));
    expect(allowance.status).toBe('DRAFT');
    expect(allowance.cap.minor).toBe(300n);
    expect(allowance.cap.currency).toBe(currency);
    expect(Object.isFrozen(allowance)).toBe(true);
    expect(Object.isFrozen(allowance.milestones)).toBe(true);
    expect(Object.isFrozen(allowance.milestones[0])).toBe(true);
  });
  it.each(['GHS', 'NGN', 'KES', 'UGX'])('rejects %s at allowance and tranche boundaries', (currency) => {
    expect(new Money(1n, currency).currency).toBe(currency);
    expect(() => new Allowance(draft(currency))).toThrow('Unsupported hold currency');
    expect(() => new Tranche('trn_fixture', new Money(1n, currency), 'construction.stage@1', 0)).toThrow(
      'Unsupported hold currency',
    );
  });
  it('requires a positive exact single-currency milestone sum', () => {
    const input = draft();
    for (const cap of [new Money(0n, 'GBP'), new Money(299n, 'GBP'), new Money(301n, 'GBP')])
      expect(() => new Allowance({ ...input, cap })).toThrow();
    expect(() => new Allowance({ ...input, milestones: [] })).toThrow();
    expect(
      () =>
        new Allowance({
          ...input,
          milestones: [{ name: 'Zero', amount: new Money(0n, 'GBP'), profileId: 'construction.stage@1' }],
        }),
    ).toThrow();
    expect(
      () =>
        new Allowance({
          ...input,
          milestones: [{ name: 'USD', amount: new Money(300n, 'USD'), profileId: 'construction.stage@1' }],
        }),
    ).toThrow();
  });
  it('validates identity, milestone names, profiles and limits', () => {
    const input = draft();
    for (const key of ['id', 'platformId', 'payeeRef'] as const)
      expect(() => new Allowance({ ...input, [key]: ' ' })).toThrow();
    for (const windowDays of [0, 29, 1.5, Number.NaN]) expect(() => new Allowance({ ...input, windowDays })).toThrow();
    for (const maxResubmits of [-1, 6, 1.5]) expect(() => new Allowance({ ...input, maxResubmits })).toThrow();
    for (const name of ['', ' ', 'Roof', ' Roof '])
      expect(
        () =>
          new Allowance({
            ...input,
            milestones: input.milestones.map((m, i) => ({ ...m, name: i === 0 ? name : m.name })),
          }),
      ).toThrow();
    expect(
      () => new Allowance({ ...input, milestones: [{ name: 'Unknown', amount: input.cap, profileId: 'unknown' }] }),
    ).toThrow();
  });
  it('owns its milestone snapshot and conserves every generated cap', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 1n, max: 1000000000n }), fc.bigInt({ min: 1n, max: 1000000000n }), (a, b) => {
        const input = draft();
        const first = { name: 'A', amount: new Money(a, 'GBP'), profileId: 'construction.stage@1' };
        const milestones = [first, { name: 'B', amount: new Money(b, 'GBP'), profileId: 'construction.stage@1' }];
        const allowance = new Allowance({ ...input, milestones, cap: new Money(a + b, 'GBP') });
        first.name = 'Changed';
        milestones.splice(0, 1, first);
        expect(allowance.milestones[0]?.name).toBe('A');
        expect(allowance.milestones.reduce((sum, stage) => sum + stage.amount.minor, 0n)).toBe(allowance.cap.minor);
      }),
    );
  });
});
