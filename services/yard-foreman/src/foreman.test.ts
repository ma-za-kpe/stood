import { MemorySaver } from '@langchain/langgraph';
import { expect, it, vi } from 'vitest';
import { Foreman, type PlannerIntake } from './foreman.js';

const intake: PlannerIntake = {
  id: 'plan',
  buyerOperatorId: 'buyer',
  repository: 'buyer/project',
  baseCommit: 'a'.repeat(40),
  description: 'Build a booking app',
  capMinor: 3000,
  currency: 'USD',
  createdAt: 1791158400000,
};
const draft = () => ({
  summary: 'A booking app',
  risks: ['Calendar integration is simulated'],
  requirements: [{ id: 'booking', text: 'A buyer can make a booking', testIds: ['booking-works'] }],
  milestones: ['Build', 'Preview', 'Handover'].map((name, index) => ({
    id: `m${index + 1}`,
    name,
    budgetMinor: 1000,
    deadline: intake.createdAt + 7 * 86400000,
    tests: [
      {
        id: 'booking-works',
        path: 'tests/booking.test.ts',
        content: 'expect(await book()).toEqual({ booked: true });',
      },
    ],
  })),
});
it('drafts through the graph, persists a buyer-review interrupt and never approves itself', async () => {
  const model = { draft: vi.fn(async () => draft()) };
  const checkpoint = new MemorySaver();
  const foreman = new Foreman(model, checkpoint);
  const plan = await foreman.draft(intake);
  expect(plan.status).toBe('BUYER_REVIEW');
  expect(plan.blueprint.status).toBe('DRAFT');
  expect(plan.blueprint.milestones.map((m) => m.profileId)).toEqual([
    'code.milestone@1',
    'code.milestone@1',
    'code.final@1',
  ]);
  expect(plan.simulated).toBe(true);
  const restarted = new Foreman(model, checkpoint);
  expect(await restarted.read('plan')).toEqual(plan);
  expect(model.draft).toHaveBeenCalledTimes(1);
  await expect(foreman.resume('plan', 'foreign', 1, 'ACCEPT')).rejects.toThrow('FORBIDDEN');
  const accepted = await restarted.resume('plan', 'buyer', 1, 'ACCEPT');
  expect(accepted.status).toBe('READY_FOR_BASELINE');
  expect(accepted.blueprint.status).toBe('DRAFT'); // acceptance never signs or posts
  await expect(restarted.resume('plan', 'buyer', 1, 'ACCEPT')).rejects.toThrow('CONFLICT');
});
it('buyer rejection ends the draft without running the model again or freezing terms', async () => {
  const model = { draft: vi.fn(async () => draft()) };
  const f = new Foreman(model, new MemorySaver());
  await f.draft(intake);
  expect((await f.resume('plan', 'buyer', 1, 'REVISE')).status).toBe('REVISION_REQUESTED');
  expect(model.draft).toHaveBeenCalledTimes(1);
});
it.each([
  { ...draft(), paid: true },
  { ...draft(), milestones: draft().milestones.map((m) => ({ ...m, budgetMinor: 2000 })) },
  { ...draft(), requirements: [{ id: 'booking', text: 'Works', testIds: ['missing'] }] },
  {
    ...draft(),
    milestones: draft().milestones.map((m) => ({ ...m, tests: [{ id: 'works', path: '../.env', content: 'x' }] })),
  },
])('rejects invalid or authority-bearing model output without making a reviewable plan', async (output) => {
  const f = new Foreman({ draft: async () => output }, new MemorySaver());
  await expect(f.draft(intake)).rejects.toThrow();
});
it('rejects malformed intake and duplicate thread ids before invoking the planner', async () => {
  const model = { draft: vi.fn(async () => draft()) };
  const f = new Foreman(model, new MemorySaver());
  await expect(f.draft({ ...intake, description: '' })).rejects.toThrow('INVALID');
  await f.draft(intake);
  await expect(f.draft({ ...intake, capMinor: 4000 })).rejects.toThrow('CONFLICT');
  expect(model.draft).toHaveBeenCalledTimes(1);
});
