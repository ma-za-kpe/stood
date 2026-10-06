import { expect, it } from 'vitest';
import { BUYER_HANDOVER_ITEMS, HANDOVER_CHECKLIST, handoverConfirmation } from './handover.js';

it('lists the Y20 §5 rotation checklist with an owner for every item (T-0207)', () => {
  expect(HANDOVER_CHECKLIST.map((i) => i.id)).toEqual([
    'production-secrets-own-hosting',
    'rotate-test-keys',
    'yard-deletes-stored-keys',
    'previews-deleted',
    'builder-access-removed',
    'github-app-decision',
    'remove-preview-trust',
    'mfa-and-billing-alerts',
    'rotate-exposed-keys',
  ]);
  expect(HANDOVER_CHECKLIST.filter((i) => i.owner === 'YARD').map((i) => i.id)).toEqual([
    'yard-deletes-stored-keys',
    'previews-deleted',
    'builder-access-removed',
  ]);
  expect(BUYER_HANDOVER_ITEMS).toHaveLength(6);
  expect(Object.isFrozen(HANDOVER_CHECKLIST)).toBe(true);
});
it('accepts a confirmation only when it names every buyer item exactly once', () => {
  expect(handoverConfirmation({ confirmed: [...BUYER_HANDOVER_ITEMS] })).toEqual([...BUYER_HANDOVER_ITEMS].sort());
  for (const bad of [
    {},
    { confirmed: BUYER_HANDOVER_ITEMS.slice(1) },
    { confirmed: [...BUYER_HANDOVER_ITEMS, 'previews-deleted'] },
    { confirmed: [...BUYER_HANDOVER_ITEMS, BUYER_HANDOVER_ITEMS[0]] },
    { confirmed: [...BUYER_HANDOVER_ITEMS], extra: true },
    { confirmed: 'all' },
  ])
    expect(() => handoverConfirmation(bad)).toThrow();
});
