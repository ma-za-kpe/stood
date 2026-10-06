import { expect, it } from 'vitest';
import { boardChecked } from './board-contract.js';

const offer = {
  id: 'a'.repeat(64),
  projectId: 'project',
  workOrderId: 'one',
  name: 'Booking app',
  priceMinor: 1000,
  deadline: 1791158400000,
  currency: 'USD',
  profile: 'code.milestone@1',
  version: 3,
  simulated: true,
};
it('accepts public posted-work metadata without private repository or money proof', () => {
  expect(boardChecked({ orders: [offer], nextCursor: null, simulated: true }).orders[0]).toEqual(offer);
  for (const bad of [
    { ...offer, repository: 'buyer/private' },
    { ...offer, priceMinor: -1 },
    { ...offer, version: 0 },
    { ...offer, currency: 'XXX' },
    { ...offer, simulated: false },
    { ...offer, paid: true },
  ])
    expect(() => boardChecked({ orders: [bad], nextCursor: null, simulated: true })).toThrow();
  expect(() => boardChecked({ orders: [offer, offer], nextCursor: null, simulated: true })).toThrow();
  expect(() => boardChecked({ orders: [offer], nextCursor: '../private', simulated: true })).toThrow();
});
