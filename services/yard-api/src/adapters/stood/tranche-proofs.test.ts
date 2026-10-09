import type { TrancheView } from '@stood/stood-sdk';
import { expect, it } from 'vitest';
import { StoodTrancheProofs } from './tranche-proofs.js';

const expiresAt = Date.parse('2026-11-07T00:00:00.000Z');
const view = (over: Partial<TrancheView> = {}): TrancheView => ({
  id: 'trn',
  state: 'HELD',
  version: 3,
  holdExpiresAt: new Date(expiresAt).toISOString(),
  settlement: null,
  decision: null,
  amount: { minor: 1000, currency: 'USD' },
  packageId: 'pkg_1',
  resubmissionsLeft: 1,
  provider: 'paypal-sandbox',
  ...over,
});
const read = (v: TrancheView) => new StoodTrancheProofs({ getTranche: async () => v }).read('trn');

// T-0189: Yard acts only on what one fresh signed Stood read shows; anything still deciding is a wait.
it('turns a held, released or refused tranche into the matching proof, and anything else into a wait', async () => {
  expect(await read(view())).toEqual({ trancheId: 'trn', effect: 'HOLD', expiresAt, simulated: true });
  expect(
    await read(view({ state: 'RELEASED', settlement: { effect: 'CAPTURE', reference: 'cap_1' }, holdExpiresAt: null })),
  ).toEqual({
    trancheId: 'trn',
    packageId: 'pkg_1',
    reference: 'cap_1',
    effect: 'CAPTURE',
    minor: 1000,
    currency: 'USD',
    simulated: true,
  });
  const decision = { outcome: 'REFUSE' as const, namedField: 'tests.booking', reason: 'Booking test failed' };
  expect(await read(view({ state: 'REFUSED', settlement: { effect: 'VOID', reference: 'void_1' }, decision }))).toEqual(
    {
      trancheId: 'trn',
      packageId: 'pkg_1',
      reference: 'void_1',
      effect: 'VOID',
      punchList: [{ field: 'tests.booking', reason: 'Booking test failed' }],
      resubmissionsLeft: 1,
      simulated: true,
    },
  );
  for (const waiting of [
    view({ state: 'DECIDING' }),
    view({ state: 'HELD', holdExpiresAt: null }),
    view({ state: 'RELEASED', settlement: { effect: 'CAPTURE', reference: 'cap_1' }, packageId: null }),
    view({ state: 'EXPIRED', settlement: { effect: 'EXPIRE', reference: 'exp_1' } }),
    view({ state: 'REFUSED', settlement: { effect: 'VOID', reference: 'void_1' }, decision: null }),
    view({
      state: 'REFUSED',
      settlement: { effect: 'VOID', reference: 'void_1' },
      decision: { ...decision, namedField: null },
    }),
  ])
    expect(await read(waiting)).toBeNull();
});
