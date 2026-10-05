import type pg from 'pg';
import { type Mutation, YardError, type YardEvent, type YardEvents, type YardSnapshot } from '../../ports/events.js';

// Operator-only migration after provisionYard. Runtime credentials never execute DDL.
export async function migrateYardEvents(pool: pg.Pool, owner: string): Promise<void> {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(owner)) throw new RangeError('Invalid Yard owner');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SET LOCAL ROLE ${owner}`);
    await c.query(`CREATE TABLE IF NOT EXISTS yard.projects (
      id text PRIMARY KEY, owner text NOT NULL, version integer NOT NULL CHECK(version>0), data jsonb NOT NULL);
      CREATE TABLE IF NOT EXISTS yard.events (
      project_id text NOT NULL REFERENCES yard.projects(id), seq integer NOT NULL CHECK(seq>0),
      type text NOT NULL CHECK(length(type)>0), actor text NOT NULL, payload jsonb NOT NULL,
      at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(project_id,seq));
      CREATE TABLE IF NOT EXISTS yard.commands (
      project_id text NOT NULL REFERENCES yard.projects(id), key text NOT NULL, fingerprint text NOT NULL,
      result jsonb NOT NULL, PRIMARY KEY(project_id,key));
      CREATE OR REPLACE FUNCTION yard.immutable_event() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Yard events are append-only'; END $$;
      DROP TRIGGER IF EXISTS immutable_event ON yard.events;
      CREATE TRIGGER immutable_event BEFORE UPDATE OR DELETE ON yard.events FOR EACH ROW EXECUTE FUNCTION yard.immutable_event();
      INSERT INTO yard.schema_migrations(version) VALUES(1) ON CONFLICT DO NOTHING;`);
    await c.query('COMMIT');
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally {
    c.release();
  }
}
const snapshot = (r: Record<string, unknown>): YardSnapshot => ({
  id: String(r.id),
  owner: String(r.owner),
  version: Number(r.version),
  data: r.data,
});
export class PostgresYardEvents implements YardEvents {
  constructor(private readonly pool: pg.Pool) {}
  async create(id: string, owner: string, data: unknown, key: string): Promise<YardSnapshot> {
    const c = await this.pool.connect();
    const result = { id, owner, version: 1, data };
    try {
      await c.query('BEGIN');
      await c.query('INSERT INTO yard.projects VALUES($1,$2,1,$3)', [id, owner, JSON.stringify(data)]);
      await c.query("INSERT INTO yard.events(project_id,seq,type,actor,payload) VALUES($1,1,'blueprint.ready',$2,$3)", [
        id,
        owner,
        JSON.stringify({ id }),
      ]);
      await c.query('INSERT INTO yard.commands VALUES($1,$2,$3,$4)', [
        id,
        key,
        JSON.stringify({ owner, data }),
        JSON.stringify(result),
      ]);
      await c.query('COMMIT');
      return result;
    } catch (error) {
      await c.query('ROLLBACK');
      if ((error as { code?: string }).code === '23505') {
        const previous = await this.pool.query(
          'SELECT fingerprint,result FROM yard.commands WHERE project_id=$1 AND key=$2',
          [id, key],
        );
        const row = previous.rows[0];
        if (row?.fingerprint === JSON.stringify({ owner, data })) return row.result as YardSnapshot;
        throw new YardError('CONFLICT');
      }
      throw error;
    } finally {
      c.release();
    }
  }
  async load(id: string): Promise<YardSnapshot> {
    const { rows } = await this.pool.query('SELECT * FROM yard.projects WHERE id=$1', [id]);
    if (!rows[0]) throw new YardError('NOT_FOUND');
    return snapshot(rows[0]);
  }
  async list(after = ''): Promise<readonly YardSnapshot[]> {
    return (await this.pool.query('SELECT * FROM yard.projects WHERE id>$1 ORDER BY id LIMIT 101', [after])).rows.map(
      snapshot,
    );
  }
  async read(id: string, after: number): Promise<readonly YardEvent[]> {
    if (!Number.isSafeInteger(after) || after < 0) throw new YardError('INVALID');
    return (
      await this.pool.query(
        'SELECT seq,type,payload,actor,at FROM yard.events WHERE project_id=$1 AND seq>$2 ORDER BY seq LIMIT 501',
        [id, after],
      )
    ).rows.map((r) => ({ ...r, at: r.at.toISOString() }));
  }
  async mutate(
    id: string,
    version: number,
    actor: string,
    key: string,
    fingerprint: string,
    change: (data: unknown) => Mutation,
  ): Promise<YardSnapshot> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const { rows } = await c.query('SELECT * FROM yard.projects WHERE id=$1 FOR UPDATE', [id]);
      if (!rows[0]) throw new YardError('NOT_FOUND');
      const previous = await c.query('SELECT fingerprint,result FROM yard.commands WHERE project_id=$1 AND key=$2', [
        id,
        key,
      ]);
      if (previous.rows[0]) {
        if (previous.rows[0].fingerprint !== `${actor}:${fingerprint}`) throw new YardError('CONFLICT');
        await c.query('COMMIT');
        return previous.rows[0].result as YardSnapshot;
      }
      if (rows[0].version !== version) throw new YardError('STALE_VERSION');
      const next = change(rows[0].data);
      const result = { id, owner: rows[0].owner, version: version + 1, data: next.data };
      await c.query('UPDATE yard.projects SET version=$2,data=$3 WHERE id=$1', [
        id,
        result.version,
        JSON.stringify(next.data),
      ]);
      await c.query('INSERT INTO yard.events(project_id,seq,type,actor,payload) VALUES($1,$2,$3,$4,$5)', [
        id,
        result.version,
        next.type,
        actor,
        JSON.stringify(next.payload),
      ]);
      await c.query('INSERT INTO yard.commands VALUES($1,$2,$3,$4)', [
        id,
        key,
        `${actor}:${fingerprint}`,
        JSON.stringify(result),
      ]);
      await c.query('COMMIT');
      return result;
    } catch (error) {
      await c.query('ROLLBACK');
      throw error;
    } finally {
      c.release();
    }
  }
}
