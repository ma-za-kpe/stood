import type pg from 'pg';
import { type PreviewSlots, SLOT_GRACE_MS } from '../../ports/preview-slots.js';

// Operator-run migration 11: one row per live preview slot, held by a deploy and then by its service.
export async function migrateYardPreviewSlots(pool: pg.Pool, owner: string): Promise<void> {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(owner)) throw new RangeError('Invalid Yard owner');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SET LOCAL ROLE ${owner}`);
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended('yard-preview-slots-migration',0))");
    if (!(await c.query('SELECT 1 FROM yard.schema_migrations WHERE version=11')).rowCount)
      await c.query(`CREATE TABLE yard.preview_slots (
          deploy_id text PRIMARY KEY CHECK(length(deploy_id) BETWEEN 1 AND 100),
          service_id text UNIQUE CHECK(service_id IS NULL OR service_id ~ '^srv-[a-z0-9]+$'),
          reserved_at bigint NOT NULL CHECK(reserved_at >= 0));
        INSERT INTO yard.schema_migrations(version) VALUES(11);`);
    await c.query('COMMIT');
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally {
    c.release();
  }
}
export class PostgresPreviewSlots implements PreviewSlots {
  constructor(private readonly pool: pg.Pool) {}
  async reserve(deployId: string, max: number, now: number): Promise<boolean> {
    if (!Number.isSafeInteger(max) || max < 1 || !Number.isSafeInteger(now))
      throw new RangeError('Invalid slot request');
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      // One reservation at a time, across every Yard instance: count and insert under the same lock.
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended('yard-preview-slots',0))");
      const { rows } = await c.query(
        'SELECT count(*)::int AS n FROM yard.preview_slots WHERE service_id IS NOT NULL OR reserved_at > $1',
        [now - SLOT_GRACE_MS],
      );
      const free = Number(rows[0]?.n ?? 0) < max;
      if (free)
        await c.query('INSERT INTO yard.preview_slots(deploy_id,reserved_at) VALUES($1,$2) ON CONFLICT DO NOTHING', [
          deployId,
          now,
        ]);
      await c.query('COMMIT');
      return free;
    } catch (error) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      c.release();
    }
  }
  async attach(deployId: string, serviceId: string): Promise<void> {
    await this.pool.query('UPDATE yard.preview_slots SET service_id=$2 WHERE deploy_id=$1', [deployId, serviceId]);
  }
  async release(by: Readonly<{ deployId?: string; serviceId?: string }>): Promise<void> {
    if (by.deployId) await this.pool.query('DELETE FROM yard.preview_slots WHERE deploy_id=$1', [by.deployId]);
    if (by.serviceId) await this.pool.query('DELETE FROM yard.preview_slots WHERE service_id=$1', [by.serviceId]);
  }
  async retain(liveServiceIds: readonly string[]): Promise<number> {
    const { rowCount } = await this.pool.query(
      'DELETE FROM yard.preview_slots WHERE service_id IS NOT NULL AND NOT (service_id = ANY($1::text[]))',
      [[...liveServiceIds]],
    );
    return rowCount ?? 0;
  }
}
