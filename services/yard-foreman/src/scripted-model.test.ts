import { expect, it } from 'vitest';
import { MemorySaver } from '../test/fakes/checkpoint.js';
import { ScriptedPlannerModel } from '../test/fakes/model.js';
import { Foreman } from './foreman.js';

it('runs the scripted model through the real graph with exact budgets and explicit fixture provenance', async () => {
  expect(() => new ScriptedPlannerModel('production')).toThrow('refused');
  const f = new Foreman(new ScriptedPlannerModel('ci'), new MemorySaver());
  const plan = await f.draft({
    id: 'scripted',
    buyerOperatorId: 'buyer',
    repository: 'buyer/project',
    baseCommit: 'a'.repeat(40),
    description: 'A booking app',
    capMinor: 3001,
    currency: 'USD',
    createdAt: 1791158400000,
  });
  expect(plan.blueprint.milestones.map((m) => m.budgetMinor)).toEqual([1000, 1000, 1001]);
  expect(plan.risks).toContain('Scripted planner output. No AI provider was called.');
  expect(plan.status).toBe('BUYER_REVIEW');
  expect(plan.simulated).toBe(true);
  await f.resume('scripted', 'buyer', 1, 'REVISE');
  expect((await f.revise('scripted', 'buyer', 1, 'Refine booking scope')).blueprint.summary).toContain('revised scope');
});
