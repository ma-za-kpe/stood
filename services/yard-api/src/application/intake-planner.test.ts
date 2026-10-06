import { expect, it, vi } from 'vitest';
import { intakeFixture } from '../../../../packages/yard-contracts/test/fakes/intake.js';
import { Foreman } from '../../../yard-foreman/src/foreman.js';
import { MemorySaver } from '../../../yard-foreman/test/fakes/checkpoint.js';
import { ScriptedPlannerModel } from '../../../yard-foreman/test/fakes/model.js';
import { YardError } from '../ports/events.js';
import type { ForemanPlans } from '../ports/foreman.js';
import { IntakePlanner } from './intake-planner.js';

const now = 1791158400000;
function setup() {
  const record = {
    id: 'idea',
    owner: 'buyer',
    version: 2,
    step: 7,
    draft: intakeFixture(now),
    createdAt: now,
    updatedAt: now,
  };
  const store = { load: vi.fn(async () => record), save: vi.fn(), read: vi.fn(async () => []) };
  const draft = vi.fn(async (input: unknown) => input);
  const read = vi.fn(async (): Promise<never> => {
    throw new YardError('NOT_FOUND');
  });
  const foreman = { draft, read } as unknown as ForemanPlans;
  const repositories = { resolve: vi.fn(async () => ({ repository: 'buyer/project', baseCommit: 'b'.repeat(40) })) };
  return { record, store, draft, read, repositories, planner: new IntakePlanner(store, foreman, repositories) };
}
it('plans an owned saved version with a server-resolved repository and every intake choice', async () => {
  const { planner, draft, repositories, record } = setup();
  await planner.create('idea', 'buyer', 2, now);
  const input = draft.mock.calls[0]?.[0] as {
    id: string;
    context: string;
    baseCommit: string;
    buyerOperatorId: string;
  };
  expect(repositories.resolve).toHaveBeenCalledWith('buyer', 'buyer/project');
  expect(input.baseCommit).toBe('b'.repeat(40));
  expect(input.buyerOperatorId).toBe('buyer');
  expect(JSON.parse(input.context)).toEqual({
    ...record.draft,
    handover: { ...record.draft.handover, baseCommit: 'b'.repeat(40) },
  });
  expect(input.id.length).toBeLessThanOrEqual(100);
});
it('rejects unowned, stale, incomplete and expired drafts before repository or model work', async () => {
  const { planner, record, draft, repositories } = setup();
  await expect(planner.create('idea', 'foreign', 2, now)).rejects.toThrow('FORBIDDEN');
  await expect(planner.create('idea', 'buyer', 1, now)).rejects.toThrow('CONFLICT');
  await expect(planner.create('idea', 'buyer', 2, record.draft.timing.deadline)).rejects.toThrow();
  Object.assign(record, { draft: { idea: { description: 'Unfinished' } } });
  await expect(planner.create('idea', 'buyer', 2, now)).rejects.toThrow();
  expect(repositories.resolve).not.toHaveBeenCalled();
  expect(draft).not.toHaveBeenCalled();
});
it('refuses a repository resolver changing the buyer-selected repository', async () => {
  const { planner, repositories, draft } = setup();
  repositories.resolve.mockResolvedValue({ repository: 'foreign/project', baseCommit: 'b'.repeat(40) });
  await expect(planner.create('idea', 'buyer', 2, now)).rejects.toThrow('CONFLICT');
  expect(draft).not.toHaveBeenCalled();
});

it('returns the saved snapshot after repository changes or deadline expiry without another provider call', async () => {
  const { store, repositories, record } = setup();
  const foreman = new Foreman(new ScriptedPlannerModel('ci'), new MemorySaver());
  const planner = new IntakePlanner(store, foreman, repositories);
  const first = await planner.create('idea', 'buyer', 2, now);
  repositories.resolve.mockResolvedValue({ repository: 'buyer/project', baseCommit: 'c'.repeat(40) });
  expect(await planner.create('idea', 'buyer', 2, now + 30 * 86400000)).toEqual(first);
  expect(repositories.resolve).toHaveBeenCalledTimes(1);
  Object.assign(record.draft.idea, { description: 'Rewritten without a new version' });
  await expect(planner.create('idea', 'buyer', 2, now)).rejects.toThrow('CONFLICT');
});
it('keeps a repository outage explicit and does not create a planning checkpoint', async () => {
  const { planner, repositories, draft } = setup();
  repositories.resolve.mockRejectedValue(new Error('Repository unavailable'));
  await expect(planner.create('idea', 'buyer', 2, now)).rejects.toThrow('Repository unavailable');
  expect(draft).not.toHaveBeenCalled();
});
