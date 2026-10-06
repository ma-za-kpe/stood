import { expect, it } from 'vitest';
import { WORK_ORDER_TRANSITIONS } from './work-order.js';

it('shares immutable build transitions without giving client events payment authority', () => {
  expect(WORK_ORDER_TRANSITIONS.CHECKING).toEqual(['SUBMITTED']);
  expect('PAID' in WORK_ORDER_TRANSITIONS).toBe(false);
  expect('REFUSED' in WORK_ORDER_TRANSITIONS).toBe(false);
  expect(Object.isFrozen(WORK_ORDER_TRANSITIONS)).toBe(true);
  for (const origins of Object.values(WORK_ORDER_TRANSITIONS)) expect(Object.isFrozen(origins)).toBe(true);
});
