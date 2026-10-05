import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { OperationalAlert, ReconciliationJob, ReconciliationQueue } from '../../ports/reconciliation-queue.js';
export class PostgresReconciliationQueue implements ReconciliationQueue {
  constructor(private readonly pool: Pick<pg.Pool, 'query'>) {}
  async seed(): Promise<void> {
    await this.pool.query(
      'INSERT INTO reconciliation_jobs (tranche_id) SELECT tranche_id FROM payment_streams WHERE record IS NOT NULL ON CONFLICT DO NOTHING',
    );
  }
  async claim(): Promise<ReconciliationJob | null> {
    const result = await this.pool.query<ReconciliationJob>(
      `WITH due AS (SELECT tranche_id FROM reconciliation_jobs WHERE next_run_at <= clock_timestamp() AND (leased_until IS NULL OR leased_until <= clock_timestamp()) ORDER BY next_run_at, tranche_id FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE reconciliation_jobs AS jobs SET lease_token = $1, leased_until = clock_timestamp() + interval '90 seconds' FROM due WHERE jobs.tranche_id = due.tranche_id RETURNING jobs.tranche_id AS "trancheId", jobs.lease_token AS "token"`,
      [randomUUID()],
    );
    return result.rows[0] ?? null;
  }
  async finish(job: ReconciliationJob, delaySeconds: number): Promise<void> {
    if (!Number.isInteger(delaySeconds) || delaySeconds < 0 || delaySeconds > 86400)
      throw new RangeError('Invalid reconciliation delay');
    await this.pool.query(
      "UPDATE reconciliation_jobs SET lease_token = NULL, leased_until = NULL, next_run_at = clock_timestamp() + ($3::integer * interval '1 second') WHERE tranche_id = $1 AND lease_token = $2",
      [job.trancheId, job.token, delaySeconds],
    );
  }
  async alert(alert: OperationalAlert): Promise<void> {
    const id = `alert_${createHash('sha256')
      .update(JSON.stringify([alert.trancheId, alert.operationKey, alert.code]))
      .digest('hex')}`;
    await this.pool.query(
      "INSERT INTO payment_alerts (id, tranche_id, operation_key, code, owner) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO UPDATE SET last_seen_at = clock_timestamp(), owner = EXCLUDED.owner, status = 'OPEN'",
      [id, alert.trancheId, alert.operationKey, alert.code, alert.owner],
    );
  }
  async resolve(trancheId: string): Promise<void> {
    await this.pool.query(
      "UPDATE payment_alerts SET status = 'RESOLVED', last_seen_at = clock_timestamp() WHERE tranche_id = $1 AND status = 'OPEN'",
      [trancheId],
    );
  }
}
