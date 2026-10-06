import { afterAll, beforeAll, expect, it } from 'vitest';
import { yardDatabase } from '../../../test/database.js';
import { migrateYardEvents } from './events.js';
import { migrateYardIntakes, PostgresIntakes } from './intakes.js';

let f: Awaited<ReturnType<typeof yardDatabase>>;
let store: PostgresIntakes;
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
  store = new PostgresIntakes(f.limited);
});
afterAll(async () => {
  if (f) await f.close();
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
