import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { expect, it, vi } from 'vitest';
import { yardDatabase } from '../../yard-api/test/database.js';
import { PostgresForemanCoordinator } from '../src/adapters/db-postgres/coordinator.js';
import { Foreman } from '../src/foreman.js';
import { ScriptedPlannerModel } from './fakes/model.js';

function reviseInFreshProcess(url: string, id: string, output: unknown) {
  const directory = mkdtempSync(join(tmpdir(), 'stood-planner-clock-'));
  try {
    const require = createRequire(import.meta.url);
    execFileSync(
      process.execPath,
      [
        require.resolve('typescript/bin/tsc'),
        '-p',
        'services/yard-foreman/tsconfig.json',
        '--outDir',
        directory,
        '--declaration',
        'false',
        '--sourceMap',
        'false',
      ],
      { timeout: 15000 },
    );
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ type: 'module' }));
    symlinkSync(resolve('services/yard-foreman/node_modules'), join(directory, 'node_modules'), 'dir');
    const script = `
      import {readFileSync} from 'node:fs';
      import pg from 'pg';
      import {PostgresSaver} from '@langchain/langgraph-checkpoint-postgres';
      import {Foreman} from ${JSON.stringify(pathToFileURL(join(directory, 'foreman.js')).href)};
      import {PostgresForemanCoordinator} from ${JSON.stringify(pathToFileURL(join(directory, 'adapters/db-postgres/coordinator.js')).href)};
      const input=JSON.parse(readFileSync(0,'utf8'));
      Date.now=()=>1791158399900;
      const pool=new pg.Pool({connectionString:input.url});
      let calls=0;
      try {
        const foreman=new Foreman({draft:async()=>{calls++;return input.output;}},new PostgresSaver(pool,undefined,{schema:'yard'}),true,new PostgresForemanCoordinator(pool));
        const plan=await foreman.revise(input.id,'buyer',1,'Add reminders');
        process.stdout.write(JSON.stringify({plan,calls}));
      } finally {await pool.end();}
    `;
    return JSON.parse(
      execFileSync(process.execPath, ['--input-type=module', '-e', script], {
        cwd: directory,
        input: JSON.stringify({ url, id, output }),
        encoding: 'utf8',
        timeout: 10000,
      }),
    ) as { plan: Awaited<ReturnType<Foreman['read']>>; calls: number };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

it('resumes the newest real-Postgres review despite host clock rollback, with no migration grants or model replay', async () => {
  const f = await yardDatabase();
  const recovered = f.connectRuntime();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1791158400000);
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
    clock.mockReturnValue(1791158399900);
    const worker = reviseInFreshProcess(String(f.limited.options.connectionString), intake.id, output);
    const revision = worker.plan;
    expect(revision.version).toBe(2);
    expect(model.draft).toHaveBeenCalledTimes(1);
    expect(worker.calls).toBe(1);
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
    clock.mockRestore();
    await recovered.end();
    await f.close();
  }
}, 30000);

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

it('never persists a recognised key from model output in real Postgres checkpoints or task writes', async () => {
  const f = await yardDatabase(),
    recovered = f.connectRuntime();
  try {
    await new PostgresSaver(f.migration, undefined, { schema: 'yard' }).setup();
    const intake = {
      id: 'private-output',
      buyerOperatorId: 'buyer',
      repository: 'buyer/project',
      baseCommit: 'a'.repeat(40),
      description: 'Build bookings',
      capMinor: 3000,
      currency: 'USD',
      createdAt: 1791158400000,
    };
    const model = new ScriptedPlannerModel('ci');
    const output = await model.draft({ intake, policy: 'Draft only' });
    const credential = ['client', 'secret'].join('_') + ' = synthetic-secret-value';
    const first = new Foreman(
      { draft: async () => ({ ...output, risks: [credential] }) },
      new PostgresSaver(f.limited, undefined, { schema: 'yard' }),
      true,
      new PostgresForemanCoordinator(f.limited),
    );
    await expect(first.draft(intake)).rejects.toThrow('INVALID_DRAFT');
    const saver = new PostgresSaver(recovered, undefined, { schema: 'yard' });
    let records = 0;
    for await (const checkpoint of saver.list({ configurable: { thread_id: intake.id } })) {
      records++;
      expect(JSON.stringify(checkpoint)).not.toContain('synthetic-secret-value');
    }
    expect(records).toBeGreaterThan(0);
    const restarted = new Foreman(model, saver, true, new PostgresForemanCoordinator(recovered));
    await expect(restarted.read(intake.id)).rejects.toThrow('NOT_FOUND');
    expect((await restarted.recover(intake.id, 'buyer')).blueprint).toMatchObject({
      buyerOperatorId: 'buyer',
      capMinor: 3000,
      status: 'DRAFT',
      termsProof: null,
    });
  } finally {
    await recovered.end();
    await f.close();
  }
});

it('persists competing manual edit receipts and the new approval pause across Postgres connections', async () => {
  const f = await yardDatabase();
  const restarted = f.connectRuntime();
  try {
    await new PostgresSaver(f.migration, undefined, { schema: 'yard' }).setup();
    const intake = {
      id: 'manual',
      buyerOperatorId: 'buyer',
      repository: 'buyer/project',
      baseCommit: 'a'.repeat(40),
      description: 'A booking app',
      capMinor: 3000,
      currency: 'USD' as const,
      createdAt: 1791158400000,
    };
    const model = new ScriptedPlannerModel('ci');
    const make = (pool: typeof f.limited) =>
      new Foreman(
        model,
        new PostgresSaver(pool, undefined, { schema: 'yard' }),
        true,
        new PostgresForemanCoordinator(pool),
      );
    const first = make(f.limited),
      other = make(restarted);
    const original = await first.draft(intake);
    const draft = await model.draft({ policy: '', intake });
    draft.summary = 'Manually reviewed booking';
    const competing = await Promise.allSettled([
      first.edit(intake.id, 'buyer', 1, 'edit-one', draft),
      other.edit(intake.id, 'buyer', 1, 'edit-two', draft),
    ]);
    expect(competing.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const key = competing[0]!.status === 'fulfilled' ? 'edit-one' : 'edit-two';
    const recovered = make(restarted);
    const edited = await recovered.read(intake.id);
    expect(edited).toMatchObject({ version: 2, status: 'BUYER_REVIEW', blueprint: { summary: draft.summary } });
    expect(await recovered.edit(intake.id, 'buyer', 1, key, draft)).toEqual(edited);
    await expect(recovered.edit(intake.id, 'buyer', 1, key, { ...draft, summary: 'Different' })).rejects.toThrow(
      'CONFLICT',
    );
    await expect(recovered.resume(intake.id, 'buyer', 1, 'ACCEPT')).rejects.toThrow('CONFLICT');
    expect((await recovered.resume(intake.id, 'buyer', 2, 'ACCEPT')).status).toBe('READY_FOR_BASELINE');
    expect(original.blueprint.summary).not.toBe(draft.summary);
  } finally {
    await restarted.end();
    await f.close();
  }
});
