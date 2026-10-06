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
