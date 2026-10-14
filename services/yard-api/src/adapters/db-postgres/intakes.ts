import { createHash } from 'node:crypto';
import { intakeChecked } from '@stood/yard-contracts';
import type pg from 'pg';
import { YardError, type YardEvent } from '../../ports/events.js';
import type { IntakePlanLock, IntakeRecord, IntakeStore, IntakeWrite } from '../../ports/intakes.js';
import { PostgresYardEvents } from './events.js';

export async function migrateYardIntakes(pool: pg.Pool, owner: string): Promise<void> {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(owner)) throw new RangeError('Invalid Yard owner');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SET LOCAL ROLE ${owner}`);
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended('yard-intakes-migration',0))");
    if ((await c.query('SELECT 1 FROM yard.schema_migrations WHERE version=3')).rowCount) {
      await c.query('COMMIT');
      return;
    }
    await c.query(`CREATE TABLE yard.intakes (
      id text PRIMARY KEY CHECK(id ~ '^[A-Za-z0-9_-]{1,100}$'), owner text NOT NULL CHECK(length(owner)>0),
      version integer NOT NULL CHECK(version>0), step integer NOT NULL CHECK(step BETWEEN 0 AND 7),
      data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),
      created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL CHECK(updated_at>=created_at AND isfinite(created_at) AND isfinite(updated_at)));
      CREATE TABLE yard.intake_events (
      intake_id text NOT NULL REFERENCES yard.intakes(id), seq integer NOT NULL CHECK(seq>0),
      type text NOT NULL CHECK(type='intake.saved'), actor text NOT NULL CHECK(length(actor)>0),
      payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object' AND
        payload ? 'version' AND payload ? 'step' AND payload - 'version' - 'step'='{}'::jsonb AND
        jsonb_typeof(payload->'version')='number' AND payload->>'version'=seq::text AND
        jsonb_typeof(payload->'step')='number' AND (payload->>'step')::integer BETWEEN 0 AND 7),
      at timestamptz NOT NULL, PRIMARY KEY(intake_id,seq));
      ALTER TABLE yard.intakes ADD CONSTRAINT intake_current_event FOREIGN KEY(id,version)
        REFERENCES yard.intake_events(intake_id,seq) DEFERRABLE INITIALLY DEFERRED;
      CREATE TABLE yard.intake_commands (
        intake_id text NOT NULL REFERENCES yard.intakes(id), key text NOT NULL,
        fingerprint text NOT NULL, result jsonb NOT NULL, PRIMARY KEY(intake_id,key));
      CREATE FUNCTION yard.guard_intake() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP='INSERT' THEN
          IF NEW.version<>1 OR NEW.created_at<>NEW.updated_at THEN RAISE EXCEPTION 'Intake must start at version one'; END IF;
        ELSE
          IF NEW.id<>OLD.id OR NEW.owner<>OLD.owner OR NEW.created_at<>OLD.created_at OR NEW.version<>OLD.version+1 OR NEW.updated_at<OLD.updated_at THEN
            RAISE EXCEPTION 'Invalid intake transition';
          END IF;
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER intake_guard BEFORE INSERT OR UPDATE ON yard.intakes FOR EACH ROW EXECUTE FUNCTION yard.guard_intake();
      CREATE FUNCTION yard.guard_intake_event() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE current yard.intakes%ROWTYPE;
      BEGIN
        SELECT * INTO current FROM yard.intakes WHERE id=NEW.intake_id;
        IF NOT FOUND OR NEW.seq<>current.version OR NEW.actor<>current.owner OR
          NEW.payload->>'step'<>current.step::text OR NEW.at<>current.updated_at THEN
          RAISE EXCEPTION 'Invalid intake event';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER intake_event_guard BEFORE INSERT ON yard.intake_events FOR EACH ROW EXECUTE FUNCTION yard.guard_intake_event();
      CREATE TRIGGER intake_event_immutable BEFORE UPDATE OR DELETE ON yard.intake_events FOR EACH ROW EXECUTE FUNCTION yard.immutable_event();
      CREATE TRIGGER intake_event_no_truncate BEFORE TRUNCATE ON yard.intake_events FOR EACH STATEMENT EXECUTE FUNCTION yard.immutable_event();
      CREATE TRIGGER intake_command_immutable BEFORE UPDATE OR DELETE ON yard.intake_commands FOR EACH ROW EXECUTE FUNCTION yard.immutable_event();
      INSERT INTO yard.schema_migrations(version) VALUES(3);`);
    await c.query('COMMIT');
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally {
    c.release();
  }
}
// T-0217: a buyer can erase an intake, and abandoned drafts expire. Intake history stays append-only except inside an
// erase transaction for that one intake (SET LOCAL yard.erase_intake); each erasure leaves only its id, reason and time.
export async function migrateYardIntakeErasure(pool: pg.Pool, owner: string): Promise<void> {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(owner)) throw new RangeError('Invalid Yard owner');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SET LOCAL ROLE ${owner}`);
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended('yard-intake-erasure-migration',0))");
    if (!(await c.query('SELECT 1 FROM yard.schema_migrations WHERE version=9')).rowCount)
      await c.query(`CREATE FUNCTION yard.intake_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP='DELETE' AND current_setting('yard.erase_intake', true) = OLD.intake_id THEN RETURN OLD; END IF;
        RAISE EXCEPTION 'Intake history is append-only';
      END $$;
      DROP TRIGGER intake_event_immutable ON yard.intake_events;
      CREATE TRIGGER intake_event_immutable BEFORE UPDATE OR DELETE ON yard.intake_events
        FOR EACH ROW EXECUTE FUNCTION yard.intake_append_only();
      DROP TRIGGER intake_command_immutable ON yard.intake_commands;
      CREATE TRIGGER intake_command_immutable BEFORE UPDATE OR DELETE ON yard.intake_commands
        FOR EACH ROW EXECUTE FUNCTION yard.intake_append_only();
      CREATE TABLE yard.intake_erasures (
        intake_id text PRIMARY KEY CHECK(intake_id ~ '^[A-Za-z0-9_-]{1,100}$'),
        reason text NOT NULL CHECK(reason IN ('BUYER_REQUEST','EXPIRED')),
        erased_at timestamptz NOT NULL CHECK(isfinite(erased_at)));
      CREATE TRIGGER intake_erasure_immutable BEFORE UPDATE OR DELETE ON yard.intake_erasures
        FOR EACH ROW EXECUTE FUNCTION yard.immutable_event();
      INSERT INTO yard.schema_migrations(version) VALUES(9);`);
    if (!(await c.query('SELECT 1 FROM yard.schema_migrations WHERE version=12')).rowCount)
      await c.query(`CREATE TABLE yard.intake_erasure_jobs (
        intake_id text PRIMARY KEY CHECK(intake_id ~ '^[A-Za-z0-9_-]{1,100}$'),
        reason text NOT NULL CHECK(reason IN ('BUYER_REQUEST','EXPIRED')),
        started_at timestamptz NOT NULL CHECK(isfinite(started_at)));
      CREATE TABLE yard.intake_erasure_targets (
        intake_id text NOT NULL REFERENCES yard.intake_erasure_jobs(intake_id),
        plan_id text NOT NULL CHECK(length(plan_id) BETWEEN 1 AND 200),
        forgotten boolean NOT NULL DEFAULT false,
        PRIMARY KEY(intake_id,plan_id));
      INSERT INTO yard.schema_migrations(version) VALUES(12);`);
    await c.query('COMMIT');
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally {
    c.release();
  }
}

// Associates deterministic Foreman thread IDs with their source intake so blueprint conversion can share the
// intake's deletion lock. Backfill every saved version so plans created before this migration remain fenced.
export async function migrateYardIntakePlanLinks(pool: pg.Pool, owner: string): Promise<void> {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(owner)) throw new RangeError('Invalid Yard owner');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SET LOCAL ROLE ${owner}`);
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended('yard-intake-plan-links-migration',0))");
    if ((await c.query('SELECT 1 FROM yard.schema_migrations WHERE version=13')).rowCount) {
      await c.query('COMMIT');
      return;
    }
    await c.query(`CREATE TABLE yard.intake_plan_links (
      plan_id text PRIMARY KEY CHECK(plan_id ~ '^intake-[a-f0-9]{64}$'),
      intake_id text NOT NULL REFERENCES yard.intakes(id) ON DELETE CASCADE,
      version integer NOT NULL CHECK(version>0),
      UNIQUE(intake_id,version));
      INSERT INTO yard.schema_migrations(version) VALUES(13);`);
    const { rows } = await c.query<{ id: string; owner: string; version: number }>(
      'SELECT id,owner,version FROM yard.intakes ORDER BY id',
    );
    const batch: { planId: string; intakeId: string; version: number }[] = [];
    const flush = async () => {
      if (!batch.length) return;
      await c.query(
        `INSERT INTO yard.intake_plan_links(plan_id,intake_id,version)
         SELECT plan_id,intake_id,version FROM jsonb_to_recordset($1::jsonb)
           AS links(plan_id text,intake_id text,version integer) ON CONFLICT DO NOTHING`,
        [
          JSON.stringify(
            batch.map(({ planId, intakeId, version }) => ({ plan_id: planId, intake_id: intakeId, version })),
          ),
        ],
      );
      batch.length = 0;
    };
    for (const intake of rows) {
      for (let version = 1; version <= Number(intake.version); version++) {
        const hash = createHash('sha256')
          .update(JSON.stringify([intake.owner, intake.id, version]))
          .digest('hex');
        batch.push({ planId: `intake-${hash}`, intakeId: intake.id, version });
        if (batch.length >= 500) await flush();
      }
    }
    await flush();
    await c.query('COMMIT');
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally {
    c.release();
  }
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, v]) => [key, canonical(v)]),
    );
  return value;
}
function record(row: Record<string, unknown>): IntakeRecord {
  const time = (v: unknown) => (v instanceof Date ? v.getTime() : new Date(String(v)).getTime());
  return {
    id: String(row.id),
    owner: String(row.owner),
    version: Number(row.version),
    step: Number(row.step),
    draft: intakeChecked(row.data),
    createdAt: time(row.created_at),
    updatedAt: time(row.updated_at),
  };
}
export class PostgresIntakes implements IntakeStore {
  private readonly wake: PostgresYardEvents;
  constructor(
    private readonly pool: pg.Pool,
    wake?: PostgresYardEvents,
    private readonly lockPool: pg.Pool = pool,
  ) {
    this.wake = wake ?? new PostgresYardEvents(pool);
  }
  subscribe(id: string, wake: () => void) {
    return this.wake.subscribe(`intake:${id}`, wake);
  }
  async withLock<T>(id: string, run: () => Promise<T>): Promise<T> {
    const c = await this.lockPool.connect();
    const lock = `yard-intake:${id}`;
    let acquired = false;
    try {
      await c.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [lock]);
      acquired = true;
      return await run();
    } finally {
      try {
        if (acquired) await c.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [lock]);
      } finally {
        c.release();
      }
    }
  }
  async withPlanLock<T>(planId: string, run: () => Promise<T>): Promise<IntakePlanLock<T>> {
    const link = await this.pool.query<{ intake_id: string }>(
      'SELECT intake_id FROM yard.intake_plan_links WHERE plan_id=$1',
      [planId],
    );
    const linked = link.rows[0];
    if (!linked) return { linked: false };
    const intakeId = String(linked.intake_id);
    const value = await this.withLock(intakeId, async () => {
      const active = await this.pool.query(
        `SELECT 1 FROM yard.intakes i
         WHERE i.id=$1
           AND NOT EXISTS (SELECT 1 FROM yard.intake_erasure_jobs j WHERE j.intake_id=i.id)
           AND NOT EXISTS (SELECT 1 FROM yard.intake_erasures e WHERE e.intake_id=i.id)`,
        [intakeId],
      );
      if (!active.rowCount) throw new YardError('CONFLICT');
      return run();
    });
    return { linked: true, value };
  }
  async registerPlan(id: string, owner: string, version: number, planId: string): Promise<void> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const current = await c.query<{ owner: string; version: number }>(
        'SELECT owner,version FROM yard.intakes WHERE id=$1 FOR KEY SHARE',
        [id],
      );
      const intake = current.rows[0];
      if (!intake) throw new YardError('NOT_FOUND');
      if (intake.owner !== owner) throw new YardError('FORBIDDEN');
      if (Number(intake.version) < version) throw new YardError('CONFLICT');
      const erasing = await c.query(
        'SELECT 1 FROM yard.intake_erasure_jobs WHERE intake_id=$1 UNION ALL SELECT 1 FROM yard.intake_erasures WHERE intake_id=$1',
        [id],
      );
      if (erasing.rowCount) throw new YardError('CONFLICT');
      await c.query(
        'INSERT INTO yard.intake_plan_links(plan_id,intake_id,version) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
        [planId, id, version],
      );
      const saved = await c.query<{ intake_id: string; version: number }>(
        'SELECT intake_id,version FROM yard.intake_plan_links WHERE plan_id=$1',
        [planId],
      );
      const savedLink = saved.rows[0];
      if (!savedLink || savedLink.intake_id !== id || Number(savedLink.version) !== version)
        throw new YardError('CONFLICT');
      await c.query('COMMIT');
    } catch (error) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      c.release();
    }
  }
  async assertNotErasing(id: string): Promise<void> {
    const result = await this.pool.query(
      'SELECT 1 FROM yard.intake_erasure_jobs WHERE intake_id=$1 UNION ALL SELECT 1 FROM yard.intake_erasures WHERE intake_id=$1',
      [id],
    );
    if (result.rowCount) throw new YardError('CONFLICT');
  }
  async prepareErasure(
    id: string,
    owner: string,
    reason: 'BUYER_REQUEST' | 'EXPIRED',
    now: number,
    planIds: readonly string[],
    eligibleBefore?: number,
  ): Promise<boolean> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const current = await c.query('SELECT owner,updated_at FROM yard.intakes WHERE id=$1 FOR UPDATE', [id]);
      if (!current.rowCount) {
        const erased = await c.query('SELECT 1 FROM yard.intake_erasures WHERE intake_id=$1', [id]);
        if (erased.rowCount) {
          await c.query('COMMIT');
          return true;
        }
        throw new YardError('NOT_FOUND');
      }
      if (current.rows[0].owner !== owner) throw new YardError('FORBIDDEN');
      if (eligibleBefore !== undefined && new Date(current.rows[0].updated_at).getTime() >= eligibleBefore) {
        await c.query('COMMIT');
        return false;
      }
      await c.query(
        'INSERT INTO yard.intake_erasure_jobs(intake_id,reason,started_at) VALUES($1,$2,$3) ON CONFLICT(intake_id) DO NOTHING',
        [id, reason, new Date(now)],
      );
      for (const planId of planIds)
        await c.query(
          'INSERT INTO yard.intake_erasure_targets(intake_id,plan_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
          [id, planId],
        );
      await c.query('COMMIT');
      return true;
    } catch (error) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      c.release();
    }
  }
  async pendingErasureTargets(id: string): Promise<readonly string[]> {
    const result = await this.pool.query(
      'SELECT plan_id FROM yard.intake_erasure_targets WHERE intake_id=$1 AND NOT forgotten ORDER BY plan_id',
      [id],
    );
    return result.rows.map((row) => String(row.plan_id));
  }
  async completeErasureTarget(id: string, planId: string): Promise<void> {
    await this.pool.query('UPDATE yard.intake_erasure_targets SET forgotten=true WHERE intake_id=$1 AND plan_id=$2', [
      id,
      planId,
    ]);
  }
  async load(id: string): Promise<IntakeRecord> {
    const result = await this.pool.query('SELECT * FROM yard.intakes WHERE id=$1', [id]);
    if (!result.rowCount) throw new YardError('NOT_FOUND');
    return record(result.rows[0]);
  }
  async read(id: string, after: number): Promise<readonly YardEvent[]> {
    if (!Number.isSafeInteger(after) || after < 0) throw new YardError('INVALID');
    const result = await this.pool.query(
      'SELECT seq,type,actor,payload,at FROM yard.intake_events WHERE intake_id=$1 AND seq>$2 ORDER BY seq LIMIT 501',
      [id, after],
    );
    return result.rows.map((r) => ({
      seq: Number(r.seq),
      type: String(r.type),
      actor: String(r.actor),
      payload: r.payload,
      at: new Date(r.at).toISOString(),
    }));
  }
  async save(input: IntakeWrite): Promise<IntakeRecord> {
    const draft = intakeChecked(input.draft);
    const { id, owner, key, expectedVersion, step, now } = input;
    if (
      !/^[A-Za-z0-9_-]{1,100}$/.test(id) ||
      !owner ||
      owner.length > 100 ||
      !/^[A-Za-z0-9:._-]{1,120}$/.test(key) ||
      !Number.isSafeInteger(expectedVersion) ||
      expectedVersion < 0 ||
      !Number.isSafeInteger(step) ||
      step < 0 ||
      step > 7 ||
      !Number.isSafeInteger(now) ||
      now < 0 ||
      !Number.isFinite(new Date(now).getTime())
    )
      throw new YardError('INVALID');
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(canonical({ id, owner, expectedVersion, step, draft })))
      .digest('hex');
    return this.withLock(id, async () => {
      const c = await this.pool.connect();
      try {
        await c.query('BEGIN');
        const erasing = await c.query('SELECT 1 FROM yard.intake_erasure_jobs WHERE intake_id=$1', [id]);
        const erased = await c.query('SELECT 1 FROM yard.intake_erasures WHERE intake_id=$1', [id]);
        if (erasing.rowCount || erased.rowCount) throw new YardError('CONFLICT');
        const current = await c.query('SELECT * FROM yard.intakes WHERE id=$1 FOR UPDATE', [id]);
        const before = current.rowCount ? record(current.rows[0]) : null;
        if (before && before.owner !== owner) throw new YardError('FORBIDDEN');
        const receipt = await c.query(
          'SELECT fingerprint,result FROM yard.intake_commands WHERE intake_id=$1 AND key=$2',
          [id, key],
        );
        if (receipt.rowCount) {
          if (receipt.rows[0].fingerprint !== fingerprint) throw new YardError('CONFLICT');
          await c.query('COMMIT');
          return structuredClone(receipt.rows[0].result as IntakeRecord);
        }
        if (expectedVersion !== (before?.version ?? 0)) throw new YardError('STALE_VERSION');
        if (before && now < before.updatedAt) throw new YardError('INVALID');
        const result: IntakeRecord = {
          id,
          owner,
          step,
          draft,
          version: expectedVersion + 1,
          createdAt: before?.createdAt ?? now,
          updatedAt: now,
        };
        const at = new Date(now);
        if (!before)
          await c.query('INSERT INTO yard.intakes VALUES($1,$2,$3,$4,$5,$6,$6)', [
            id,
            owner,
            result.version,
            step,
            JSON.stringify(draft),
            at,
          ]);
        else
          await c.query('UPDATE yard.intakes SET version=$2,step=$3,data=$4,updated_at=$5 WHERE id=$1', [
            id,
            result.version,
            step,
            JSON.stringify(draft),
            at,
          ]);
        await c.query("INSERT INTO yard.intake_events VALUES($1,$2,'intake.saved',$3,$4,$5)", [
          id,
          result.version,
          owner,
          JSON.stringify({ step, version: result.version }),
          at,
        ]);
        await c.query('INSERT INTO yard.intake_commands VALUES($1,$2,$3,$4)', [
          id,
          key,
          fingerprint,
          JSON.stringify(result),
        ]);
        await c.query("SELECT pg_notify('yard_events', $1)", [`intake:${id}`]);
        await c.query('COMMIT');
        return structuredClone(result);
      } catch (error) {
        await c.query('ROLLBACK');
        throw error;
      } finally {
        c.release();
      }
    });
  }
  // T-0217: erases the intake, its history and its idempotency receipts in one transaction; a repeat is a no-op.
  async erase(
    id: string,
    owner: string,
    reason: 'BUYER_REQUEST' | 'EXPIRED',
    now: number,
    eligibleBefore?: number,
  ): Promise<'ERASED' | 'ALREADY' | 'FRESH'> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const current = await c.query('SELECT owner,updated_at FROM yard.intakes WHERE id=$1 FOR UPDATE', [id]);
      if (!current.rowCount) {
        const done = await c.query('SELECT 1 FROM yard.intake_erasures WHERE intake_id=$1', [id]);
        await c.query('COMMIT');
        if (done.rowCount) return 'ALREADY';
        throw new YardError('NOT_FOUND');
      }
      if (current.rows[0].owner !== owner) throw new YardError('FORBIDDEN');
      if (eligibleBefore !== undefined && new Date(current.rows[0].updated_at).getTime() >= eligibleBefore) {
        await c.query('COMMIT');
        return 'FRESH';
      }
      const pending = await c.query(
        'SELECT 1 FROM yard.intake_erasure_targets WHERE intake_id=$1 AND NOT forgotten LIMIT 1',
        [id],
      );
      if (pending.rowCount) throw new Error('Intake cleanup is incomplete');
      await c.query("SELECT set_config('yard.erase_intake', $1, true)", [id]);
      await c.query('DELETE FROM yard.intake_commands WHERE intake_id=$1', [id]);
      await c.query('DELETE FROM yard.intake_events WHERE intake_id=$1', [id]);
      await c.query('DELETE FROM yard.intakes WHERE id=$1', [id]);
      await c.query('DELETE FROM yard.intake_erasure_targets WHERE intake_id=$1', [id]);
      await c.query('DELETE FROM yard.intake_erasure_jobs WHERE intake_id=$1', [id]);
      await c.query('INSERT INTO yard.intake_erasures(intake_id,reason,erased_at) VALUES($1,$2,$3)', [
        id,
        reason,
        new Date(now).toISOString(),
      ]);
      await c.query('COMMIT');
      return 'ERASED';
    } catch (error) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      c.release();
    }
  }
  // T-0217: drafts nobody has touched since `before`, with their owners, oldest first.
  async idle(
    before: number,
    limit = 100,
    after?: Readonly<{ updatedAt: number; id: string }>,
  ): Promise<readonly Readonly<{ id: string; owner: string; updatedAt: number }>[]> {
    const result = await this.pool.query(
      `SELECT id,owner,updated_at FROM yard.intakes
       WHERE updated_at < $1 AND ($3::timestamptz IS NULL OR (updated_at,id) > ($3,$4))
       ORDER BY updated_at, id LIMIT $2`,
      [
        new Date(before).toISOString(),
        Math.max(1, Math.min(limit, 500)),
        after ? new Date(after.updatedAt) : null,
        after?.id ?? null,
      ],
    );
    return result.rows.map((r) => ({
      id: String(r.id),
      owner: String(r.owner),
      updatedAt: new Date(r.updated_at).getTime(),
    }));
  }
}
