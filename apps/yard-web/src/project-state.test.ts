import { expect, it } from 'vitest';
import { applyEvent, type ProjectRoom, roomChecked } from './project-state.js';

const room: ProjectRoom = {
  id: 'p',
  version: 6,
  summary: 'Booking app',
  simulated: true,
  currency: 'USD',
  orders: [
    {
      id: 'one',
      name: 'Build',
      state: 'CHECKING',
      budgetMinor: 1000,
      submission: { packageId: 'package', commit: 'a'.repeat(40) },
      trancheId: 'tranche',
      payment: null,
      leasedUntil: null,
    },
  ],
};
const event = {
  seq: 7,
  type: 'stood.released',
  actor: 'stood',
  payload: {
    wo: 'one',
    state: 'PAID',
    payment: {
      trancheId: 'tranche',
      packageId: 'package',
      reference: 'capture',
      effect: 'CAPTURE',
      minor: 1000,
      currency: 'USD',
      simulated: true,
    },
  },
};
it('renders money only from exact consecutive Stood evidence; duplicate, gaps and forged proof cannot change it', () => {
  const paid = applyEvent(room, event);
  expect(paid).not.toBe('GAP');
  if (paid === 'GAP') throw new Error('expected room');
  expect(paid.orders[0]?.state).toBe('PAID');
  expect(applyEvent(paid, event)).toEqual(paid);
  for (const bad of [
    { ...event, seq: 8 },
    { ...event, actor: 'builder' },
    { ...event, payload: { ...event.payload, payment: { ...event.payload.payment, minor: 999 } } },
    { ...event, payload: { wo: 'one', state: 'PAID' } },
  ])
    expect(applyEvent(room, bad)).toBe('GAP');
  expect(room.orders[0]?.state).toBe('CHECKING');
});
it('applies a consecutive build transition and reloads unknown or illegal transitions', () => {
  const initial = { ...room, orders: room.orders.map((o) => ({ ...o, state: 'CLAIMED' as const })) };
  expect(
    applyEvent(initial, { seq: 7, type: 'wo.building', actor: 'builder', payload: { wo: 'one', state: 'BUILDING' } }),
  ).toMatchObject({ version: 7, orders: [{ state: 'BUILDING' }] });
  expect(
    applyEvent(room, { seq: 7, type: 'wo.building', actor: 'builder', payload: { wo: 'one', state: 'BUILDING' } }),
  ).toBe('GAP');
  expect(applyEvent(room, { seq: 7, type: 'unknown', actor: 'builder', payload: {} })).toBe('GAP');
});

it('rejects malformed snapshots before displaying work or money', () => {
  expect(roomChecked(room)).toEqual(room);
  for (const invalid of [
    null,
    { ...room, version: -1 },
    { ...room, currency: 'INVALID' },
    { ...room, id: '' },
    { ...room, orders: [...room.orders, ...room.orders] },
    ...[-1, 0, NaN].map((budgetMinor) => ({ ...room, orders: [{ ...room.orders[0], budgetMinor }] })),
    ...['INVENTED', 'REFUSED', 'RELEASED'].map((state) => ({ ...room, orders: [{ ...room.orders[0], state }] })),
    { ...room, orders: [{ ...room.orders[0], submission: { packageId: '', commit: 'oops' } }] },
    { ...room, orders: [{ ...room.orders[0], leasedUntil: -1 }] },
  ]) {
    expect(() => roomChecked(invalid)).toThrow();
  }
  const paid = { ...room, orders: [{ ...room.orders[0], state: 'PAID', payment: event.payload.payment }] };
  expect(roomChecked(paid).orders[0]?.state).toBe('PAID');
  for (const payment of [
    null,
    { ...event.payload.payment, reference: '' },
    { ...event.payload.payment, minor: 999 },
    { ...event.payload.payment, packageId: 'other' },
  ])
    expect(() => roomChecked({ ...paid, orders: [{ ...paid.orders[0], payment }] })).toThrow();
});

const refusal = {
  seq: 7,
  type: 'stood.refused',
  actor: 'stood',
  payload: {
    wo: 'one',
    state: 'REWORK',
    reference: 'void',
    attempt: 2,
    punchList: [{ field: 'signed_tests_changed', reason: 'The signed tests were changed.' }],
    simulated: true,
  },
};
it('shows a Stood refusal as rework with its punch list and never as a payment (T-0189)', () => {
  const reworked = applyEvent(room, refusal);
  if (reworked === 'GAP') throw new Error('expected room');
  expect(reworked.orders[0]).toMatchObject({
    state: 'REWORK',
    attempt: 2,
    submission: null,
    payment: null,
    punchList: [{ field: 'signed_tests_changed' }],
  });
  for (const bad of [
    { ...refusal, actor: 'builder' },
    { ...refusal, payload: { ...refusal.payload, state: 'PAID' } },
    { ...refusal, payload: { ...refusal.payload, punchList: [] } },
    { ...refusal, payload: { ...refusal.payload, punchList: [{ field: 'Bad', reason: 'x' }] } },
    { ...refusal, payload: { ...refusal.payload, attempt: 1 } },
  ])
    expect(applyEvent(room, bad)).toBe('GAP');
  const paidRoom = applyEvent(room, event);
  if (paidRoom === 'GAP') throw new Error('expected room');
  expect(applyEvent(paidRoom, { ...refusal, seq: 8 })).toBe('GAP');
  // The same builder restarts from rework using the shared transition table.
  const building = applyEvent(reworked, {
    seq: 8,
    type: 'wo.building',
    actor: 'builder',
    payload: { wo: 'one', state: 'BUILDING' },
  });
  if (building === 'GAP') throw new Error('expected room');
  expect(building.orders[0]).toMatchObject({ state: 'BUILDING', punchList: [{ field: 'signed_tests_changed' }] });
  // A final refusal closes the order without starting another attempt.
  const closed = applyEvent(room, { ...refusal, payload: { ...refusal.payload, state: 'REFUSED', attempt: 1 } });
  if (closed === 'GAP') throw new Error('expected room');
  expect(closed.orders[0]).toMatchObject({ state: 'REFUSED', payment: null });
});
it('accepts rework and closed refusals in snapshots only with a punch list and no payment', () => {
  const order = room.orders[0]!;
  const punchList = [{ field: 'weak_tests', reason: 'Weak tests.' }];
  const refusals = [{ packageId: 'package', reference: 'void', attempt: 1, final: false }];
  const snapshot = (patch: Record<string, unknown>) => ({
    ...room,
    orders: [{ ...order, submission: null, ...patch }],
  });
  expect(roomChecked(snapshot({ state: 'REWORK', attempt: 2, punchList, refusals })).orders[0]?.state).toBe('REWORK');
  expect(
    roomChecked(snapshot({ state: 'REFUSED', attempt: 1, punchList, refusals: [{ ...refusals[0], final: true }] }))
      .orders[0]?.state,
  ).toBe('REFUSED');
  for (const bad of [
    snapshot({ state: 'REWORK', attempt: 2, punchList: null, refusals }),
    snapshot({ state: 'REWORK', attempt: 2, punchList: [{ field: 'x y', reason: 'r' }], refusals }),
    snapshot({ state: 'REFUSED', attempt: 1, punchList, refusals }),
    snapshot({ state: 'REFUSED', attempt: 1, punchList, refusals: [{ ...refusals[0], final: true }], payment: {} }),
  ])
    expect(() => roomChecked(bad)).toThrow();
});
it('advances past private placeholders and secret metadata without reloading, but still detects gaps (T-0194)', () => {
  for (const type of ['yard.private', 'secret.added', 'secret.revoked']) {
    const next = applyEvent(room, { seq: 7, type, actor: '', payload: {} });
    if (next === 'GAP') throw new Error('expected room');
    expect(next.version).toBe(7);
    expect(next.orders).toEqual(room.orders);
    expect(applyEvent(room, { seq: 9, type, actor: '', payload: {} })).toBe('GAP');
    expect(applyEvent(room, { seq: 6, type, actor: '', payload: {} })).toBe(room);
  }
});
