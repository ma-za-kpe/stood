import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { MemorySaver } from '@langchain/langgraph';
import { expect, it, vi } from 'vitest';
import { intakeFixture } from '../../../packages/yard-contracts/test/fakes/intake.js';
import { checkpointTimeFloor, Foreman, type PlannerIntake, type PlannerModel } from './foreman.js';

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
it('passes the complete immutable intake to the model and preserves it through review and revision', async () => {
  const context = JSON.stringify(intakeFixture(intake.createdAt));
  const model = { draft: vi.fn(async (_input: Parameters<PlannerModel['draft']>[0]) => draft()) };
  const f = new Foreman(model, new MemorySaver());
  const input = { ...intake, context };
  const plan = await f.draft(input);
  expect(model.draft.mock.calls[0]?.[0].intake.context).toBe(context);
  expect(plan).toHaveProperty('intakeContext', context);
  await f.resume(intake.id, 'buyer', 1, 'REVISE');
  expect(await f.revise(intake.id, 'buyer', 1, 'Add a reminder')).toHaveProperty('intakeContext', context);
  expect(await f.draft({ ...input, createdAt: intake.createdAt + 30 * 86400000 })).toHaveProperty(
    'intakeContext',
    context,
  );
  expect(model.draft).toHaveBeenCalledTimes(2);
});
it('refuses intake-context conflicts and scope expansion before saving model work', async () => {
  const context = intakeFixture(intake.createdAt);
  const model = { draft: vi.fn(async () => draft()) };
  const f = new Foreman(model, new MemorySaver());
  for (const change of [
    { ...context, timing: { ...context.timing, capMinor: 4000 } },
    { ...context, handover: { ...context.handover, repository: 'foreign/project' } },
    { ...context, idea: { ...context.idea, description: 'Other work' } },
    { ...context, timing: { ...context.timing, deadline: intake.createdAt } },
  ])
    await expect(f.draft({ ...intake, context: JSON.stringify(change) })).rejects.toThrow('INVALID');
  expect(model.draft).not.toHaveBeenCalled();
  await expect(f.read(intake.id)).rejects.toThrow('NOT_FOUND');
});
it('refuses recognised pasted credentials before checkpointing or calling the model', async () => {
  const model = { draft: vi.fn(async () => draft()) };
  const checkpoint = new MemorySaver();
  const foreman = new Foreman(model, checkpoint);
  const pasted = ['sk', 'live', ''].join('_') + 'synthetic-not-a-real-key';
  await expect(foreman.draft({ ...intake, description: `Connect with ${pasted}` })).rejects.toThrow('INVALID');
  expect(model.draft).not.toHaveBeenCalled();
  expect(await checkpoint.getTuple({ configurable: { thread_id: intake.id } })).toBeUndefined();
});
it('refuses credentials in revision feedback without changing the saved review', async () => {
  const model = { draft: vi.fn(async () => draft()) };
  const foreman = new Foreman(model, new MemorySaver());
  await foreman.draft(intake);
  const before = await foreman.resume(intake.id, intake.buyerOperatorId, 1, 'REVISE');
  await expect(
    foreman.revise(intake.id, intake.buyerOperatorId, 1, 'client_secret = synthetic-secret-value'),
  ).rejects.toThrow('INVALID');
  expect(await foreman.read(intake.id)).toEqual(before);
  expect(model.draft).toHaveBeenCalledTimes(1);
});
it('restores the newest revision even if the host wall clock moves backwards', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1791158400000);
  try {
    const checkpoint = new MemorySaver();
    const foreman = new Foreman({ draft: async () => draft() }, checkpoint);
    await foreman.draft({ ...intake, id: 'clock-rollback' });
    await foreman.resume('clock-rollback', 'buyer', 1, 'REVISE');
    clock.mockReturnValue(1791158399900);
    expect((await foreman.revise('clock-rollback', 'buyer', 1, 'Refine scope')).version).toBe(2);
    expect((await new Foreman({ draft: async () => draft() }, checkpoint).read('clock-rollback')).version).toBe(2);
  } finally {
    clock.mockRestore();
  }
});
it('keeps fresh-process checkpoint IDs after the persisted checkpoint time floor', () => {
  const require = createRequire(createRequire(import.meta.url).resolve('@langchain/langgraph'));
  const path = require.resolve('@langchain/langgraph-checkpoint');
  const { uuid6 } = require('@langchain/langgraph-checkpoint') as { uuid6(step: number): string };
  const parent = uuid6(0),
    floor = checkpointTimeFloor(parent);
  const child = execFileSync(
    process.execPath,
    [
      '-e',
      'const {uuid6}=require(process.argv[1]);Date.now=()=>1;process.stdout.write(uuid6(0,Number(process.argv[2])));',
      path,
      String(floor),
    ],
    { encoding: 'utf8', timeout: 5000 },
  );
  expect(child > parent).toBe(true);
  expect(() => checkpointTimeFloor('not-a-checkpoint')).toThrow('INVALID');
});
it('drafts through the graph, persists a buyer-review interrupt and never approves itself', async () => {
  const model = { draft: vi.fn(async (_input: Parameters<PlannerModel['draft']>[0]) => draft()) };
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
  const model = { draft: vi.fn(async (_input: Parameters<PlannerModel['draft']>[0]) => draft()) };
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
  const model = { draft: vi.fn(async (_input: Parameters<PlannerModel['draft']>[0]) => draft()) };
  const f = new Foreman(model, new MemorySaver());
  await expect(f.draft({ ...intake, description: '' })).rejects.toThrow('INVALID');
  await f.draft(intake);
  await expect(f.draft({ ...intake, capMinor: 4000 })).rejects.toThrow('CONFLICT');
  expect(model.draft).toHaveBeenCalledTimes(1);
});

it('rejects budgets that cannot fund three positive milestones before calling the model', async () => {
  const model = { draft: vi.fn(async (_input: Parameters<PlannerModel['draft']>[0]) => draft()) };
  const f = new Foreman(model, new MemorySaver());
  for (const capMinor of [1, 2]) {
    await expect(f.draft({ ...intake, id: `small-${capMinor}`, capMinor })).rejects.toThrow('INVALID');
  }
  expect(model.draft).not.toHaveBeenCalled();
  await expect(f.read('small-1')).rejects.toThrow('NOT_FOUND');
  await expect(f.read('small-2')).rejects.toThrow('NOT_FOUND');
});

it('serialises concurrent drafts for the same durable thread without running the model twice', async () => {
  const model = { draft: vi.fn(async (_input: Parameters<PlannerModel['draft']>[0]) => draft()) };
  const saver = new MemorySaver();
  const first = new Foreman(model, saver),
    second = new Foreman(model, saver);
  const [a, b] = await Promise.all([first.draft(intake), second.draft({ ...intake })]);
  expect(a).toEqual(b);
  expect(model.draft).toHaveBeenCalledTimes(1);
});

it('recovers a failed model task after restart with the original owner and immutable intake', async () => {
  const saver = new MemorySaver();
  const first = new Foreman(
    {
      draft: async () => {
        throw new Error('model unavailable');
      },
    },
    saver,
  );
  await expect(first.draft(intake)).rejects.toThrow('model unavailable');
  const model = { draft: vi.fn(async (_input: Parameters<PlannerModel['draft']>[0]) => draft()) };
  const restored = new Foreman(model, saver);
  await expect(restored.recover('plan', 'stranger')).rejects.toThrow('FORBIDDEN');
  await expect(restored.draft({ ...intake, capMinor: 4000 })).rejects.toThrow('CONFLICT');
  expect(model.draft).not.toHaveBeenCalled();
  expect((await restored.recover('plan', 'buyer')).status).toBe('BUYER_REVIEW');
  expect(model.draft).toHaveBeenCalledTimes(1);
  expect(await restored.draft(intake)).toEqual(await restored.read('plan'));
  expect(model.draft).toHaveBeenCalledTimes(1);
});

it('revises only a rejected draft, increments the review version and preserves every fixed intake field', async () => {
  const model = { draft: vi.fn(async (_input: Parameters<PlannerModel['draft']>[0]) => draft()) };
  const saver = new MemorySaver();
  const first = new Foreman(model, saver);
  const original = await first.draft(intake);
  await expect(first.revise('plan', 'buyer', 1, 'Add reminders')).rejects.toThrow('CONFLICT');
  await first.resume('plan', 'buyer', 1, 'REVISE');
  const restored = new Foreman(model, saver);
  await expect(restored.revise('plan', 'foreign', 1, 'Add reminders')).rejects.toThrow('FORBIDDEN');
  await expect(restored.revise('plan', 'buyer', 1, '')).rejects.toThrow('INVALID');
  const revised = await restored.revise('plan', 'buyer', 1, 'Add reminders');
  expect(revised).toMatchObject({ status: 'BUYER_REVIEW', version: 2, blueprint: original.blueprint });
  expect(model.draft.mock.calls[1]?.[0]).toMatchObject({
    intake,
    revision: { version: 2, feedback: 'Add reminders' },
  });
  await expect(restored.resume('plan', 'buyer', 1, 'ACCEPT')).rejects.toThrow('CONFLICT');
  expect((await restored.resume('plan', 'buyer', 2, 'ACCEPT')).status).toBe('READY_FOR_BASELINE');
  expect(model.draft).toHaveBeenCalledTimes(2);
});

it('recovers a failed revision without accepting or overwriting the previous draft', async () => {
  const saver = new MemorySaver();
  const model = { draft: vi.fn().mockResolvedValueOnce(draft()).mockRejectedValueOnce(new Error('offline')) };
  const first = new Foreman(model, saver);
  const original = await first.draft(intake);
  await first.resume('plan', 'buyer', 1, 'REVISE');
  await expect(first.revise('plan', 'buyer', 1, 'Fix scope')).rejects.toThrow('offline');
  expect(await first.read('plan')).toMatchObject({
    status: 'REVISION_REQUESTED',
    version: 1,
    blueprint: original.blueprint,
  });
  await expect(first.resume('plan', 'buyer', 1, 'ACCEPT')).rejects.toThrow('CONFLICT');
  const restarted = new Foreman({ draft: async () => draft() }, saver);
  expect(await restarted.recover('plan', 'buyer')).toMatchObject({ status: 'BUYER_REVIEW', version: 2 });
});

it('does not replay the model when recovering a completed review or accepted plan', async () => {
  const model = { draft: vi.fn(async (_input: Parameters<PlannerModel['draft']>[0]) => draft()) };
  const f = new Foreman(model, new MemorySaver());
  const plan = await f.draft(intake);
  expect(await f.recover('plan', 'buyer')).toEqual(plan);
  await f.resume('plan', 'buyer', 1, 'ACCEPT');
  expect((await f.recover('plan', 'buyer')).status).toBe('READY_FOR_BASELINE');
  expect(model.draft).toHaveBeenCalledTimes(1);
  await expect(f.recover('missing', 'buyer')).rejects.toThrow('NOT_FOUND');
  await expect(f.recover('bad id', 'buyer')).rejects.toThrow('INVALID');
});

it('allows only one competing revision and rejects invalid review decisions without granting authority', async () => {
  const model = { draft: vi.fn(async (_input: Parameters<PlannerModel['draft']>[0]) => draft()) };
  const f = new Foreman(model, new MemorySaver());
  await f.draft(intake);
  await expect(f.resume('plan', 'buyer', 1, 'PAY' as 'ACCEPT')).rejects.toThrow('INVALID');
  expect((await f.read('plan')).status).toBe('BUYER_REVIEW');
  await f.resume('plan', 'buyer', 1, 'REVISE');
  const results = await Promise.allSettled([
    f.revise('plan', 'buyer', 1, 'Scope A'),
    f.revise('plan', 'buyer', 1, 'Scope B'),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  expect(model.draft).toHaveBeenCalledTimes(2);
});

it('bounds revisions and keeps accepted baseline work outside the revision loop', async () => {
  const model = { draft: vi.fn(async (_input: Parameters<PlannerModel['draft']>[0]) => draft()) };
  const f = new Foreman(model, new MemorySaver());
  await f.draft(intake);
  for (let version = 1; version < 20; version++) {
    await f.resume('plan', 'buyer', version, 'REVISE');
    expect((await f.revise('plan', 'buyer', version, 'Refine scope')).version).toBe(version + 1);
  }
  await f.resume('plan', 'buyer', 20, 'REVISE');
  await expect(f.revise('plan', 'buyer', 20, 'One more')).rejects.toThrow('CONFLICT');
  expect(model.draft).toHaveBeenCalledTimes(20);
});

it('rejects model deadlines beyond the complete intake deadline', async () => {
  const context = intakeFixture(intake.createdAt);
  context.timing.deadline = intake.createdAt + 86400000;
  const f = new Foreman({ draft: async () => draft() }, new MemorySaver());
  await expect(f.draft({ ...intake, context: JSON.stringify(context) })).rejects.toThrow('INVALID_DRAFT');
});

it('edits unsigned drafts without a model call, persists an exact retry receipt and requires fresh approval', async () => {
  const model = { draft: vi.fn(async () => draft()) };
  const saver = new MemorySaver();
  const f = new Foreman(model, saver);
  const original = await f.draft(intake);
  const changes = draft();
  changes.summary = 'Booking and reminders';
  changes.milestones[0]!.budgetMinor = 800;
  changes.milestones[1]!.budgetMinor = 1200;
  const edited = await f.edit('plan', 'buyer', 1, 'edit-one', changes);
  expect(edited).toMatchObject({
    status: 'BUYER_REVIEW',
    version: 2,
    blueprint: { summary: changes.summary, capMinor: 3000, repository: intake.repository },
  });
  expect(original.blueprint.summary).toBe('A booking app');
  const restored = new Foreman(model, saver);
  expect(await restored.edit('plan', 'buyer', 1, 'edit-one', changes)).toEqual(edited);
  await expect(restored.resume('plan', 'buyer', 1, 'ACCEPT')).rejects.toThrow('CONFLICT');
  expect((await restored.resume('plan', 'buyer', 2, 'ACCEPT')).status).toBe('READY_FOR_BASELINE');
  expect(await restored.edit('plan', 'buyer', 1, 'edit-one', changes)).toEqual(edited);
  await expect(restored.edit('plan', 'buyer', 2, 'edit-two', changes)).rejects.toThrow('CONFLICT');
  expect(model.draft).toHaveBeenCalledTimes(1);
});
it('refuses foreign, stale, invalid and competing manual edits without losing the prior draft', async () => {
  const f = new Foreman({ draft: async () => draft() }, new MemorySaver());
  const original = await f.draft(intake);
  await expect(f.edit('plan', 'foreign', 1, 'edit', draft())).rejects.toThrow('FORBIDDEN');
  await expect(f.edit('plan', 'buyer', 0, 'edit', draft())).rejects.toThrow('CONFLICT');
  await expect(f.edit('plan', 'buyer', 1, '', draft())).rejects.toThrow('INVALID');
  await expect(f.edit('plan', 'buyer', 1, 'edit', { ...draft(), capMinor: 9999 })).rejects.toThrow('INVALID');
  const bad = draft();
  bad.milestones[0]!.budgetMinor = 9999;
  await expect(f.edit('plan', 'buyer', 1, 'edit', bad)).rejects.toThrow();
  expect(await f.read('plan')).toEqual(original);
  const results = await Promise.allSettled([
    f.edit('plan', 'buyer', 1, 'a', draft()),
    f.edit('plan', 'buyer', 1, 'b', draft()),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  await expect(f.edit('plan', 'buyer', 1, 'a', { ...draft(), summary: 'Different' })).rejects.toThrow('CONFLICT');
});
