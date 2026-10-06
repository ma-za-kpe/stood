import { expect, it } from 'vitest';
import { intakeFixture } from '../../../packages/yard-contracts/test/fakes/intake.js';
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

it('fits scripted milestones within the exact saved deadline at sub-minute clock precision', async () => {
  const at = 1791158400001;
  const context = intakeFixture(at);
  const deadline = Math.floor((at + 21 * 86400000) / 60000) * 60000;
  const saved = { ...context, timing: { ...context.timing, deadline } };
  const foreman = new Foreman(new ScriptedPlannerModel('ci'), new MemorySaver());
  const plan = await foreman.draft({
    id: 'deadline-precision',
    buyerOperatorId: 'buyer',
    repository: context.handover.repository,
    baseCommit: context.handover.baseCommit,
    description: context.idea.description,
    capMinor: context.timing.capMinor,
    currency: context.timing.currency,
    createdAt: at,
    context: JSON.stringify(saved),
  });
  expect(plan.blueprint.milestones.every((m) => m.deadline > at && m.deadline <= deadline)).toBe(true);
  expect(plan.blueprint.milestones.at(-1)?.deadline).toBe(deadline);
  await foreman.resume('deadline-precision', 'buyer', 1, 'REVISE');
  const revised = await foreman.revise('deadline-precision', 'buyer', 1, 'Keep the delivery deadline');
  expect(revised.blueprint.milestones.at(-1)?.deadline).toBe(deadline);
});
