import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { expect, it, vi } from 'vitest';
import { yardDatabase } from '../../yard-api/test/database.js';
import { PostgresForemanCoordinator } from '../src/adapters/db-postgres/coordinator.js';
import { Foreman } from '../src/foreman.js';

it('resumes a real-Postgres review checkpoint with a new runtime connection, no migration grants or model replay', async () => {
  const f = await yardDatabase();
  const recovered = f.connectRuntime();
  try {
    const provisioning = new PostgresSaver(f.migration, undefined, { schema: 'yard' });
    await provisioning.setup();
    const intake = {
      id: 'persistent',
      buyerOperatorId: 'buyer',
      repository: 'buyer/project',
      baseCommit: 'a'.repeat(40),
      description: 'A booking app',
      capMinor: 3000,
      currency: 'USD',
      createdAt: 1791158400000,
    };
    const output = {
      summary: 'A booking app',
      risks: [],
      requirements: [{ id: 'booking', text: 'Can book', testIds: ['works'] }],
      milestones: ['Build', 'Preview', 'Handover'].map((name, i) => ({
        id: `m${i}`,
        name,
        budgetMinor: 1000,
        deadline: intake.createdAt + 86400000,
        tests: [{ id: 'works', path: 'tests/booking.test.ts', content: 'expect(await book()).toBe(true);' }],
      })),
    };
    const model = { draft: vi.fn(async () => output) };
    const first = new Foreman(
      model,
      new PostgresSaver(f.limited, undefined, { schema: 'yard' }),
      true,
      new PostgresForemanCoordinator(f.limited),
    );
    const concurrent = new Foreman(
      model,
      new PostgresSaver(recovered, undefined, { schema: 'yard' }),
      true,
      new PostgresForemanCoordinator(recovered),
    );
    const [plan, duplicate] = await Promise.all([first.draft(intake), concurrent.draft(intake)]);
    expect(duplicate).toEqual(plan);
    expect(model.draft).toHaveBeenCalledTimes(1);
    await first.resume(intake.id, 'buyer', 1, 'REVISE');
    const revision = await concurrent.revise(intake.id, 'buyer', 1, 'Add reminders');
    expect(revision.version).toBe(2);
    expect(model.draft).toHaveBeenCalledTimes(2);
    const second = new Foreman(
      {
        draft: async () => {
          throw new Error('must not call model on restore');
        },
      },
      new PostgresSaver(recovered, undefined, { schema: 'yard' }),
      true,
      new PostgresForemanCoordinator(recovered),
    );
    expect(await second.read(intake.id)).toEqual(revision);
    expect((await second.resume(intake.id, 'buyer', 2, 'ACCEPT')).status).toBe('READY_FOR_BASELINE');
    await expect(f.limited.query('CREATE TABLE yard.forbidden (id text)')).rejects.toThrow();
  } finally {
    await recovered.end();
    await f.close();
  }
});

it('releases the Postgres thread lock when model work fails and requires pool capacity', async () => {
  const f = await yardDatabase();
  const recovered = f.connectRuntime();
  try {
    const a = new PostgresForemanCoordinator(f.limited),
      b = new PostgresForemanCoordinator(recovered);
    await expect(
      a.run('failed', async () => {
        throw new Error('model unavailable');
      }),
    ).rejects.toThrow('model unavailable');
    expect(await b.run('failed', async () => 'recovered')).toBe('recovered');
    const previous = f.limited.options.max;
    f.limited.options.max = 1;
    expect(() => new PostgresForemanCoordinator(f.limited)).toThrow('COORDINATOR_CAPACITY');
    f.limited.options.max = previous;
  } finally {
    await recovered.end();
    await f.close();
  }
});
