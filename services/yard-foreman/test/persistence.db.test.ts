import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { expect, it } from 'vitest';
import { yardDatabase } from '../../yard-api/test/database.js';
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
    const first = new Foreman(
      { draft: async () => output },
      new PostgresSaver(f.limited, undefined, { schema: 'yard' }),
    );
    const plan = await first.draft(intake);
    const second = new Foreman(
      {
        draft: async () => {
          throw new Error('must not call model on restore');
        },
      },
      new PostgresSaver(recovered, undefined, { schema: 'yard' }),
    );
    expect(await second.read(intake.id)).toEqual(plan);
    expect((await second.resume(intake.id, 'buyer', 1, 'ACCEPT')).status).toBe('READY_FOR_BASELINE');
    await expect(f.limited.query('CREATE TABLE yard.forbidden (id text)')).rejects.toThrow();
  } finally {
    await recovered.end();
    await f.close();
  }
});
