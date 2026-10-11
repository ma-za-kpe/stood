import type pg from 'pg';
import type { NoticeLog } from '../../ports/notifications.js';

// Operator-run migrations 7 and 10: notification cursors, and notice keys leased then delivered.
export async function migrateYardNotices(pool: pg.Pool, owner: string): Promise<void> {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(owner)) throw new RangeError('Invalid Yard owner');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SET LOCAL ROLE ${owner}`);
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended('yard-notices-migration',0))");
    if (!(await c.query('SELECT 1 FROM yard.schema_migrations WHERE version=7')).rowCount)
      await c.query(`CREATE TABLE yard.notice_cursors (
          project_id text PRIMARY KEY, seq integer NOT NULL CHECK(seq>=0));
        CREATE TABLE yard.notices_sent (
          key text PRIMARY KEY CHECK(length(key) BETWEEN 1 AND 400), at timestamptz NOT NULL DEFAULT clock_timestamp());
        INSERT INTO yard.schema_migrations(version) VALUES(7);`);
    // Fifth audit (2026-10-11): a claim is a lease until delivery is confirmed, so a crash mid-send is retried.
    if (!(await c.query('SELECT 1 FROM yard.schema_migrations WHERE version=10')).rowCount)
      await c.query(`ALTER TABLE yard.notices_sent
          ADD COLUMN leased_until bigint NOT NULL DEFAULT 0,
          ADD COLUMN delivered_at bigint;
        UPDATE yard.notices_sent SET delivered_at=(extract(epoch FROM at)*1000)::bigint;
        INSERT INTO yard.schema_migrations(version) VALUES(10);`);
    await c.query('COMMIT');
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally {
    c.release();
  }
}
export class PostgresNoticeLog implements NoticeLog {
  constructor(private readonly pool: pg.Pool) {}
  async cursor(projectId: string): Promise<number> {
    const { rows } = await this.pool.query('SELECT seq FROM yard.notice_cursors WHERE project_id=$1', [projectId]);
    return rows[0] ? Number(rows[0].seq) : 0;
  }
  async advance(projectId: string, seq: number): Promise<void> {
    // Cursors only move forward, even under racing workers.
    await this.pool.query(
      'INSERT INTO yard.notice_cursors VALUES($1,$2) ON CONFLICT(project_id) DO UPDATE SET seq=GREATEST(yard.notice_cursors.seq, EXCLUDED.seq)',
      [projectId, seq],
    );
  }
  async claim(key: string, now: number, leaseMs: number): Promise<'CLAIMED' | 'BUSY' | 'DELIVERED'> {
    // A new key, or one whose lease ran out undelivered, is leased to this caller; the row lock settles racing workers.
    const { rowCount } = await this.pool.query(
      `INSERT INTO yard.notices_sent(key,leased_until) VALUES($1,$2)
       ON CONFLICT(key) DO UPDATE SET leased_until=EXCLUDED.leased_until
       WHERE yard.notices_sent.delivered_at IS NULL AND yard.notices_sent.leased_until<=$3`,
      [key, now + leaseMs, now],
    );
    if ((rowCount ?? 0) === 1) return 'CLAIMED';
    const { rows } = await this.pool.query('SELECT delivered_at FROM yard.notices_sent WHERE key=$1', [key]);
    return rows[0]?.delivered_at === null ? 'BUSY' : 'DELIVERED';
  }
  async delivered(key: string, now: number): Promise<void> {
    await this.pool.query('UPDATE yard.notices_sent SET delivered_at=$2 WHERE key=$1 AND delivered_at IS NULL', [
      key,
      now,
    ]);
  }
  async release(key: string): Promise<void> {
    await this.pool.query('UPDATE yard.notices_sent SET leased_until=0 WHERE key=$1 AND delivered_at IS NULL', [key]);
  }
}
