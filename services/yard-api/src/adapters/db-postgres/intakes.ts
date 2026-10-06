import { createHash } from 'node:crypto';
import { intakeChecked } from '@stood/yard-contracts';
import type pg from 'pg';
import { YardError, type YardEvent } from '../../ports/events.js';
import type { IntakeRecord, IntakeStore, IntakeWrite } from '../../ports/intakes.js';
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
  constructor(private readonly pool: pg.Pool) {
    this.wake = new PostgresYardEvents(pool);
  }
  subscribe(id: string, wake: () => void) {
    return this.wake.subscribe(`intake:${id}`, wake);
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
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended('yard-intake:' || $1,0))", [id]);
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
  }
}
