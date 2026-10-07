import type pg from 'pg';
import type { NoticeLog } from '../../ports/notifications.js';

// Operator-run migration 7: notification cursors and sent keys.
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
  async claim(key: string): Promise<boolean> {
    const { rowCount } = await this.pool.query('INSERT INTO yard.notices_sent(key) VALUES($1) ON CONFLICT DO NOTHING', [
      key,
    ]);
    return (rowCount ?? 0) === 1;
  }
  async release(key: string): Promise<void> {
    await this.pool.query('DELETE FROM yard.notices_sent WHERE key=$1', [key]);
  }
}
