import type pg from 'pg';
import type { ForemanCoordinator } from '../../coordinator.js';

// A separate pool connection holds the thread lock while LangGraph persists
// checkpoints. The runtime pool must have capacity for both connections.
export class PostgresForemanCoordinator implements ForemanCoordinator {
  constructor(private readonly pool: pg.Pool) {
    if ((pool.options.max ?? 10) < 2) throw new Error('COORDINATOR_CAPACITY');
  }
  async run<T>(id: string, work: () => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let broken = false;
    const failed = () => {
      broken = true;
    };
    client.on('error', failed);
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`yard:foreman:${id}`]);
      const result = await work();
      if (broken) throw new Error('COORDINATOR_UNAVAILABLE');
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        broken = true;
      }
      throw error;
    } finally {
      client.removeListener('error', failed);
      client.release(broken);
    }
  }
}
