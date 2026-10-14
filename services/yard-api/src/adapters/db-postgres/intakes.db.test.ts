import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { yardDatabase } from '../../../test/database.js';
import { eraseIntake } from '../../application/intake-erasure.js';
import { intakePlanId } from '../../application/intake-planner.js';
import { YardError } from '../../ports/events.js';
import { migrateYardEvents } from './events.js';
import {
  migrateYardIntakeErasure,
  migrateYardIntakePlanLinks,
  migrateYardIntakes,
  PostgresIntakes,
} from './intakes.js';

let f: Awaited<ReturnType<typeof yardDatabase>>;
let store: PostgresIntakes;
let intakeLockPool: pg.Pool;
const command = (id: string) => ({
  id,
  owner: 'buyer',
  key: 'initial',
  expectedVersion: 0,
  step: 0,
  draft: { idea: { description: 'Build a booking app' } },
  now: 1791158400000,
});
beforeAll(async () => {
  f = await yardDatabase();
  await migrateYardEvents(f.pool, f.owner);
  await migrateYardIntakes(f.pool, f.owner);
  await migrateYardIntakeErasure(f.pool, f.owner);
  await migrateYardIntakeErasure(f.pool, f.owner);
  intakeLockPool = new pg.Pool({ connectionString: f.limited.options.connectionString, max: 5 });
  store = new PostgresIntakes(f.limited, undefined, intakeLockPool);
  const legacy = command('legacy-plan-links');
  await store.save(legacy);
  await store.save({ ...legacy, key: 'second', expectedVersion: 1, now: legacy.now + 1 });
  await store.save({ ...legacy, key: 'third', expectedVersion: 2, now: legacy.now + 2 });
  await migrateYardIntakePlanLinks(f.pool, f.owner);
  await migrateYardIntakePlanLinks(f.pool, f.owner);
});
afterAll(async () => {
  if (intakeLockPool) await intakeLockPool.end();
  if (f) await f.close();
});
it('backfills a fence for every pre-migration intake plan version', async () => {
  const links = await f.limited.query(
    'SELECT version FROM yard.intake_plan_links WHERE intake_id=$1 ORDER BY version',
    ['legacy-plan-links'],
  );
  expect(links.rows).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }]);
  const result = await store.withPlanLock(intakePlanId('buyer', 'legacy-plan-links', 1), async () => 'locked');
  expect(result).toEqual({ linked: true, value: 'locked' });
});
it('restores a private draft and exact save receipt through a new connection', async () => {
  const input = command('resume');
  const first = await store.save(input);
  const connection = f.connectRuntime();
  try {
    const restored = new PostgresIntakes(connection);
    expect(await restored.load(input.id)).toEqual(first);
    expect(await restored.save({ ...input, now: input.now + 1000 })).toEqual(first);
    expect(await restored.read(input.id, 0)).toEqual([
      {
        seq: 1,
        type: 'intake.saved',
        actor: 'buyer',
        payload: { step: 0, version: 1 },
        at: new Date(input.now).toISOString(),
      },
    ]);
    await expect(restored.save({ ...input, owner: 'foreign' })).rejects.toThrow('FORBIDDEN');
    await expect(restored.save({ ...input, draft: { idea: { description: 'Changed' } } })).rejects.toThrow('CONFLICT');
  } finally {
    await connection.end();
  }
});
it('serialises competing autosaves and keeps one consecutive audit event per version', async () => {
  const input = command('concurrent');
  await store.save(input);
  const results = await Promise.allSettled(
    ['left', 'right'].map((key) =>
      store.save({
        ...input,
        key,
        expectedVersion: 1,
        step: 1,
        draft: { ...input.draft, audience: { offline: 'YES' } },
        now: input.now + 1,
      }),
    ),
  );
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(await store.load(input.id)).toMatchObject({
    version: 2,
    step: 1,
    createdAt: input.now,
    updatedAt: input.now + 1,
  });
  expect((await store.read(input.id, 0)).map((e) => e.seq)).toEqual([1, 2]);
  expect((await store.read(input.id, 1)).map((e) => e.seq)).toEqual([2]);
});
it('keeps saves waiting on the intake fence out of the main database pool', async () => {
  const connectionString = f.limited.options.connectionString;
  if (!connectionString) throw new Error('Test database URL is missing');
  const mainPool = new pg.Pool({ connectionString, max: 5, connectionTimeoutMillis: 2000 });
  const lockPool = new pg.Pool({ connectionString, max: 5 });
  const isolated = new PostgresIntakes(mainPool, undefined, lockPool);
  const input = command('pool-fence');
  await isolated.save(input);
  let entered!: () => void;
  let queued!: () => void;
  const enteredLock = new Promise<void>((resolve) => (entered = resolve));
  const savesStarted = new Promise<void>((resolve) => (queued = resolve));
  const holder = isolated.withLock(input.id, async () => {
    entered();
    await savesStarted;
    await new Promise((resolve) => setTimeout(resolve, 100));
    return isolated.load(input.id);
  });
  await enteredLock;
  const saves = Array.from({ length: 5 }, (_, i) =>
    isolated.save({ ...input, key: `waiting-${i}`, expectedVersion: 1, step: 1, now: input.now + 1 }),
  );
  queued();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const loaded = await Promise.race([
      holder,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('lock holder was starved by waiting saves')), 3000);
      }),
    ]);
    expect(loaded).toMatchObject({ id: input.id, version: 1 });
    expect(mainPool.waitingCount).toBe(0);
    expect((await Promise.allSettled(saves)).filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  } finally {
    if (timeout) clearTimeout(timeout);
    await Promise.allSettled([holder, ...saves]);
    await lockPool.end();
    await mainPool.end();
  }
});
it('rejects recognised secrets and credential fields before any database write', async () => {
  const input = command('secret');
  await expect(
    store.save({ ...input, draft: { idea: { description: 'client_secret = synthetic-secret-value' } } }),
  ).rejects.toThrow('CREDENTIAL_IN_INTAKE');
  await expect(store.load(input.id)).rejects.toThrow('NOT_FOUND');
  const rows = await f.limited.query('SELECT * FROM yard.intake_events WHERE intake_id=$1', [input.id]);
  expect(rows.rowCount).toBe(0);
});
it('rolls back the draft and command receipt when its audit insert fails', async () => {
  const input = command('rollback');
  const before = await store.save(input);
  const c = await f.pool.connect();
  try {
    await c.query(`SET ROLE ${f.owner}`);
    await c.query(
      "CREATE FUNCTION yard.reject_intake_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.intake_id='rollback' AND NEW.seq=2 THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_intake_failure BEFORE INSERT ON yard.intake_events FOR EACH ROW EXECUTE FUNCTION yard.reject_intake_event()",
    );
    const change = { ...input, key: 'next', expectedVersion: 1, step: 1, now: input.now + 1 };
    await expect(store.save(change)).rejects.toThrow('test audit failure');
    expect(await store.load(input.id)).toEqual(before);
    expect(await store.read(input.id, 0)).toHaveLength(1);
    await c.query('DROP TRIGGER test_intake_failure ON yard.intake_events; DROP FUNCTION yard.reject_intake_event()');
    expect(await store.save(change)).toMatchObject({ version: 2 });
  } finally {
    await c.query('RESET ROLE');
    c.release();
  }
});
it('guards owner, creation time, increasing versions and append-only history in the database', async () => {
  const input = command('guards');
  await store.save(input);
  for (const sql of [
    "UPDATE yard.intakes SET owner='foreign',version=2 WHERE id='guards'",
    "UPDATE yard.intakes SET created_at=created_at+interval '1 second',version=2 WHERE id='guards'",
    "UPDATE yard.intakes SET version=1 WHERE id='guards'",
    "UPDATE yard.intake_events SET actor='foreign' WHERE intake_id='guards'",
    "DELETE FROM yard.intake_events WHERE intake_id='guards'",
    "UPDATE yard.intakes SET version=2 WHERE id='guards'",
  ])
    await expect(f.limited.query(sql)).rejects.toThrow();
  expect(await store.load(input.id)).toMatchObject({ owner: 'buyer', version: 1 });
});
it('bounds cursors and rejects backwards new writes while preserving exact replay', async () => {
  const input = command('clock');
  await store.save(input);
  for (const after of [NaN, -1, 1.5]) await expect(store.read(input.id, after)).rejects.toThrow('INVALID');
  await expect(store.save({ ...input, key: 'backwards', expectedVersion: 1, now: input.now - 1 })).rejects.toThrow(
    'INVALID',
  );
  expect(await store.save({ ...input, now: input.now - 1 })).toMatchObject({ version: 1 });
  await expect(store.load('unknown')).rejects.toThrow('NOT_FOUND');
});
it('rejects audit metadata that does not match the current private draft version', async () => {
  const input = command('event-identity');
  await store.save(input);
  for (const mismatch of [
    { actor: 'foreign', step: 1, extra: false, at: input.now + 1 },
    { actor: 'buyer', step: 0, extra: false, at: input.now + 1 },
    { actor: 'buyer', step: 1, extra: true, at: input.now + 1 },
    { actor: 'buyer', step: 1, extra: false, at: input.now },
  ]) {
    const c = await f.limited.connect();
    try {
      await c.query('BEGIN');
      await c.query('UPDATE yard.intakes SET version=2,step=1,updated_at=$2 WHERE id=$1', [
        input.id,
        new Date(input.now + 1),
      ]);
      await expect(
        c.query("INSERT INTO yard.intake_events VALUES($1,2,'intake.saved',$2,$3,$4)", [
          input.id,
          mismatch.actor,
          JSON.stringify({
            version: 2,
            step: mismatch.step,
            ...(mismatch.extra ? { draft: 'must not enter the stream' } : {}),
          }),
          new Date(mismatch.at),
        ]),
      ).rejects.toThrow();
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  }
});

// T-0217: the owning buyer erases an intake with its whole history; nothing else can delete intake history.
it('erases an intake, its history and receipts for its owner only, once, and lists idle drafts', async () => {
  const input = command('erase-me');
  await store.save(input);
  await store.save({ ...input, key: 'second', expectedVersion: 1, step: 1, now: input.now + 1000 });
  await expect(f.limited.query("DELETE FROM yard.intake_events WHERE intake_id='erase-me'")).rejects.toThrow(
    /append-only/,
  );
  expect((await store.idle(input.now + 2000)).map((d) => d.id)).toContain('erase-me');
  expect(await store.idle(input.now)).not.toContainEqual(expect.objectContaining({ id: 'erase-me' }));
  await expect(store.erase('erase-me', 'foreign', 'BUYER_REQUEST', input.now + 3000)).rejects.toThrow('FORBIDDEN');
  expect(await store.erase('erase-me', 'buyer', 'BUYER_REQUEST', input.now + 3000)).toBe('ERASED');
  await expect(store.load('erase-me')).rejects.toThrow('NOT_FOUND');
  expect(await store.read('erase-me', 0)).toEqual([]);
  const left = await f.limited.query("SELECT count(*)::int AS n FROM yard.intake_commands WHERE intake_id='erase-me'");
  expect(left.rows[0].n).toBe(0);
  const erasure = await f.limited.query("SELECT reason FROM yard.intake_erasures WHERE intake_id='erase-me'");
  expect(erasure.rows).toEqual([{ reason: 'BUYER_REQUEST' }]);
  expect(await store.erase('erase-me', 'buyer', 'BUYER_REQUEST', input.now + 4000)).toBe('ALREADY');
  await expect(store.erase('never-existed', 'buyer', 'EXPIRED', input.now)).rejects.toThrow('NOT_FOUND');
  await expect(f.limited.query("DELETE FROM yard.intake_erasures WHERE intake_id='erase-me'")).rejects.toThrow();
});

it('persists cleanup targets before deletion, resumes after interruption, and fences saves until cleanup completes', async () => {
  const input = command('resume-erasure');
  await store.save(input);
  const targets = ['plan-one', 'plan-two'];
  await store.withLock(input.id, async () => {
    const lock = await f.limited.query(
      "SELECT pg_try_advisory_xact_lock(hashtextextended('yard-intake:' || $1,0)) AS acquired",
      [input.id],
    );
    expect(lock.rows[0].acquired).toBe(false);
    expect(await store.prepareErasure(input.id, input.owner, 'BUYER_REQUEST', input.now + 1, targets)).toBe(true);
  });

  await expect(store.save({ ...input, key: 'after-delete-start', now: input.now + 2 })).rejects.toThrow('CONFLICT');
  expect(await store.pendingErasureTargets(input.id)).toEqual(targets);
  await expect(store.erase(input.id, input.owner, 'BUYER_REQUEST', input.now + 3)).rejects.toThrow(
    'Intake cleanup is incomplete',
  );

  const [firstTarget, secondTarget] = targets;
  if (!firstTarget || !secondTarget) throw new Error('Test targets are missing');
  await store.completeErasureTarget(input.id, firstTarget);
  expect(await store.pendingErasureTargets(input.id)).toEqual([secondTarget]);
  await store.completeErasureTarget(input.id, secondTarget);
  expect(await store.erase(input.id, input.owner, 'BUYER_REQUEST', input.now + 4)).toBe('ERASED');
  expect(await store.pendingErasureTargets(input.id)).toEqual([]);
  await expect(store.save({ ...input, key: 'resurrect', now: input.now + 5 })).rejects.toThrow('CONFLICT');
});

it('fences project conversion against intake erasure from before creation through the final write', async () => {
  const input = command('conversion-fence');
  await store.save(input);
  const planId = intakePlanId(input.owner, input.id, 1);
  await store.registerPlan(input.id, input.owner, 1, planId);
  let started!: () => void;
  let release!: () => void;
  const conversionStarted = new Promise<void>((resolve) => (started = resolve));
  const waitForRelease = new Promise<void>((resolve) => (release = resolve));
  let projectCreated = false;
  const conversion = store.withPlanLock(planId, async () => {
    started();
    await waitForRelease;
    projectCreated = true;
  });
  await conversionStarted;
  const erasure = eraseIntake(input.id, input.owner, input.now + 1, {
    intakes: store,
    projects: {
      load: async (id: string) => {
        if (id === planId && projectCreated) return { id, owner: input.owner, version: 1, data: {} };
        throw new YardError('NOT_FOUND');
      },
    },
    foreman: { forget: async () => {} },
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(projectCreated).toBe(false);
  release();
  await conversion;
  await expect(erasure).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(await store.load(input.id)).toMatchObject({ id: input.id, version: 1 });
});

it('rechecks the expiry cutoff while holding the row lock so a fresh save survives', async () => {
  const input = command('fresh-expiry');
  await store.save(input);
  const cutoff = input.now + 1000;
  const updated = await store.save({ ...input, key: 'fresh-save', expectedVersion: 1, now: cutoff + 1 });
  expect(await store.erase(input.id, input.owner, 'EXPIRED', cutoff + 2, cutoff)).toBe('FRESH');
  expect(await store.load(input.id)).toEqual(updated);
});

it('paginates expired drafts with a stable keyset cursor beyond the first hundred', async () => {
  const base = { ...command('expiry-page'), now: command('expiry-page').now + 86_400_000 };
  for (let index = 0; index < 101; index++)
    await store.save({
      ...base,
      id: `expiry-page-${String(index).padStart(3, '0')}`,
      key: `save-${index}`,
      now: base.now + index,
    });
  const seen = new Set<string>();
  let after: { updatedAt: number; id: string } | undefined;
  while (true) {
    const page = await store.idle(base.now + 1000, 100, after);
    if (!page.length) break;
    for (const draft of page) seen.add(draft.id);
    const last = page.at(-1);
    if (!last) break;
    after = { updatedAt: last.updatedAt, id: last.id };
  }
  for (let index = 0; index < 101; index++)
    expect(seen.has(`expiry-page-${String(index).padStart(3, '0')}`)).toBe(true);
});
