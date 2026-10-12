import { expect, it } from 'vitest';
import { qualifiedYardPayment } from './yard-qualification.js';

const expected = { trancheId: 'tranche', packageId: 'package', minor: 100, currency: 'USD' };
const stood = {
  id: 'tranche',
  package_id: 'package',
  provider: 'paypal-sandbox',
  state: 'RELEASED',
  amount: { minor: 100, currency: 'USD' },
  settlement: { effect: 'CAPTURE', reference: 'capture-reference' },
};
const yard = {
  state: 'PAID',
  usage: { forwarded: { status: 'ACCEPTED' } },
  payment: {
    trancheId: 'tranche',
    packageId: 'package',
    effect: 'CAPTURE',
    reference: 'capture-reference',
    minor: 100,
    currency: 'USD',
  },
};
it('requires the exact real Stood capture and accepted hosted usage to qualify a Yard payment', () => {
  expect(qualifiedYardPayment(expected, stood, yard)).toBe(true);
  for (const changed of [
    { ...stood, provider: 'simulator' },
    { ...stood, state: 'HELD' },
    { ...stood, package_id: 'another-package' },
    { ...stood, id: 'another-tranche' },
    { ...stood, settlement: null },
    { ...stood, settlement: { effect: 'VOID', reference: 'capture-reference' } },
    { ...stood, amount: { minor: 200, currency: 'USD' } },
  ])
    expect(qualifiedYardPayment(expected, changed, yard)).toBe(false);
  for (const changed of [
    { ...yard, state: 'CHECKING' },
    { ...yard, payment: null },
    { ...yard, usage: null },
    { ...yard, payment: { ...yard.payment, reference: 'another-reference' } },
    { ...yard, payment: { ...yard.payment, packageId: 'another-package' } },
    { ...yard, payment: { ...yard.payment, minor: 200 } },
    { ...yard, usage: { forwarded: { status: 'REFUSED' } } },
  ])
    expect(qualifiedYardPayment(expected, stood, changed)).toBe(false);
});
