import { createHash } from 'node:crypto';
import { siteLogBatchChecked } from '@stood/yard-contracts';
import type pg from 'pg';
import { YardError } from '../../ports/events.js';
import type { LogEntry, LogReceipt, LogSnapshot, LogSummary, LogWrite, SiteLogs } from '../../ports/site-log.js';
import { SiteLogError } from '../../ports/site-log.js';
import { PostgresYardEvents } from './events.js';

const validId = (v: string) => /^[A-Za-z0-9_-]{1,100}$/.test(v);
const time = (v: number) => Number.isSafeInteger(v) && v >= 0 && Number.isFinite(new Date(v).getTime());
function ids(project: string, wo: string) {
  if (!validId(project) || !validId(wo)) throw new SiteLogError('INVALID_LOG');
}
export async function migrateYardSiteLogs(pool: pg.Pool, owner: string): Promise<void> {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(owner)) throw new RangeError('Invalid Yard owner');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SET LOCAL ROLE ${owner}`);
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended('yard-site-log-migration',0))");
    if ((await c.query('SELECT 1 FROM yard.schema_migrations WHERE version=4')).rowCount) {
      await c.query('COMMIT');
      return;
    }
    await c.query(`CREATE TABLE yard.site_logs (
      project_id text NOT NULL REFERENCES yard.projects(id), work_order_id text NOT NULL CHECK(work_order_id ~ '^[A-Za-z0-9_-]{1,100}$'),
      version integer NOT NULL DEFAULT 0 CHECK(version>=0), archived_through integer NOT NULL DEFAULT 0 CHECK(archived_through BETWEEN 0 AND version),
      summary jsonb, PRIMARY KEY(project_id,work_order_id));
      CREATE TABLE yard.site_log_lines (
      project_id text NOT NULL, work_order_id text NOT NULL, seq integer NOT NULL CHECK(seq>0),
      actor text NOT NULL CHECK(length(actor) BETWEEN 1 AND 100),
      kind text NOT NULL CHECK(kind IN ('plan','edit','test_run','commit','submit','punch_list_received','clock_out','note')),
      message text NOT NULL CHECK(length(message) BETWEEN 1 AND 2048), data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),
      at timestamptz NOT NULL CHECK(isfinite(at)), PRIMARY KEY(project_id,work_order_id,seq),
      FOREIGN KEY(project_id,work_order_id) REFERENCES yard.site_logs(project_id,work_order_id));
      CREATE TABLE yard.site_log_commands (
        project_id text NOT NULL, work_order_id text NOT NULL, actor text NOT NULL, key text NOT NULL,
        fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'), version integer NOT NULL CHECK(version>0), count integer NOT NULL CHECK(count BETWEEN 1 AND 20),
        PRIMARY KEY(project_id,work_order_id,actor,key), FOREIGN KEY(project_id,work_order_id) REFERENCES yard.site_logs(project_id,work_order_id));
      CREATE TABLE yard.site_log_writers (actor text PRIMARY KEY, last_write_at timestamptz NOT NULL CHECK(isfinite(last_write_at)));
      CREATE TRIGGER site_log_line_immutable BEFORE UPDATE ON yard.site_log_lines FOR EACH ROW EXECUTE FUNCTION yard.immutable_event();
      CREATE TRIGGER site_log_command_immutable BEFORE UPDATE OR DELETE ON yard.site_log_commands FOR EACH ROW EXECUTE FUNCTION yard.immutable_event();
      CREATE INDEX site_log_retention ON yard.site_log_lines(at,project_id,work_order_id);
      INSERT INTO yard.schema_migrations(version) VALUES(4);`);
    await c.query('COMMIT');
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally {
    c.release();
  }
}
function entry(row: Record<string, unknown>): LogEntry {
  const [line] = siteLogBatchChecked({
    lines: [
      { kind: row.kind, message: row.message, ...(Object.keys(row.data as object).length ? { data: row.data } : {}) },
    ],
  });
  return {
    seq: Number(row.seq),
    actor: String(row.actor),
    at: (row.at instanceof Date ? row.at : new Date(String(row.at))).toISOString(),
    line: line!,
  };
}
export class PostgresSiteLogs implements SiteLogs {
  private readonly wake: PostgresYardEvents;
  constructor(
    private readonly pool: pg.Pool,
    wake?: PostgresYardEvents,
  ) {
    this.wake = wake ?? new PostgresYardEvents(pool);
  }
  subscribe(projectId: string, workOrderId: string, wake: () => void) {
    ids(projectId, workOrderId);
    return this.wake.subscribe(`log:${projectId}:${workOrderId}`, wake);
  }
  async append(input: LogWrite): Promise<LogReceipt> {
    const { projectId, workOrderId, actor, key, now } = input;
    ids(projectId, workOrderId);
    if (!actor || actor.length > 100 || !/^[A-Za-z0-9:._-]{1,120}$/.test(key) || !time(now))
      throw new SiteLogError('INVALID_LOG');
    const lines = siteLogBatchChecked({ lines: input.lines });
    const fingerprint = createHash('sha256').update(JSON.stringify(lines)).digest('hex');
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const project = await c.query('SELECT * FROM yard.projects WHERE id=$1 FOR UPDATE', [projectId]);
      if (!project.rowCount) throw new YardError('NOT_FOUND');
      const p = project.rows[0];
      input.authorize({ id: p.id, owner: p.owner, version: p.version, data: p.data });
      const previous = await c.query(
        'SELECT fingerprint,version,count FROM yard.site_log_commands WHERE project_id=$1 AND work_order_id=$2 AND actor=$3 AND key=$4',
        [projectId, workOrderId, actor, key],
      );
      if (previous.rowCount) {
        const receipt = previous.rows[0];
        if (receipt.fingerprint !== fingerprint) throw new YardError('CONFLICT');
        await c.query('COMMIT');
        return { version: receipt.version, count: receipt.count, accepted: true };
      }
      await c.query('INSERT INTO yard.site_log_writers(actor,last_write_at) VALUES($1,$2) ON CONFLICT DO NOTHING', [
        actor,
        new Date(now - 1000),
      ]);
      const writer = await c.query('SELECT last_write_at FROM yard.site_log_writers WHERE actor=$1 FOR UPDATE', [
        actor,
      ]);
      if (now - new Date(writer.rows[0].last_write_at).getTime() < 1000) throw new SiteLogError('RATE_LIMITED');
      await c.query('INSERT INTO yard.site_logs(project_id,work_order_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [
        projectId,
        workOrderId,
      ]);
      const log = await c.query(
        'SELECT version FROM yard.site_logs WHERE project_id=$1 AND work_order_id=$2 FOR UPDATE',
        [projectId, workOrderId],
      );
      const before = Number(log.rows[0].version);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        await c.query('INSERT INTO yard.site_log_lines VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [
          projectId,
          workOrderId,
          before + i + 1,
          actor,
          line.kind,
          line.message,
          JSON.stringify('data' in line ? line.data : {}),
          new Date(now),
        ]);
      }
      const version = before + lines.length;
      await c.query('UPDATE yard.site_logs SET version=$3 WHERE project_id=$1 AND work_order_id=$2', [
        projectId,
        workOrderId,
        version,
      ]);
      await c.query('INSERT INTO yard.site_log_commands VALUES($1,$2,$3,$4,$5,$6,$7)', [
        projectId,
        workOrderId,
        actor,
        key,
        fingerprint,
        version,
        lines.length,
      ]);
      await c.query('UPDATE yard.site_log_writers SET last_write_at=$2 WHERE actor=$1', [actor, new Date(now)]);
      await c.query("SELECT pg_notify('yard_events',$1)", [`log:${projectId}:${workOrderId}`]);
      await c.query('COMMIT');
      return { version, count: lines.length, accepted: true };
    } catch (error) {
      await c.query('ROLLBACK');
      throw error;
    } finally {
      c.release();
    }
  }
  async bounds(projectId: string, workOrderId: string): Promise<{ version: number; retainedFrom: number }> {
    ids(projectId, workOrderId);
    const result = await this.pool.query(
      'SELECT version, archived_through FROM yard.site_logs WHERE project_id=$1 AND work_order_id=$2',
      [projectId, workOrderId],
    );
    const row = result.rows[0];
    return row ? { version: row.version, retainedFrom: row.archived_through + 1 } : { version: 0, retainedFrom: 1 };
  }
  async snapshot(projectId: string, workOrderId: string): Promise<LogSnapshot> {
    ids(projectId, workOrderId);
    // One statement sees metadata and retained lines from the same database snapshot.
    const result = await this.pool.query(
      `SELECT s.version,s.archived_through,s.summary,l.seq,l.actor,l.kind,l.message,l.data,l.at
      FROM yard.site_logs s LEFT JOIN LATERAL (SELECT * FROM yard.site_log_lines WHERE project_id=s.project_id AND work_order_id=s.work_order_id ORDER BY seq DESC LIMIT 200) l ON true
      WHERE s.project_id=$1 AND s.work_order_id=$2 ORDER BY l.seq`,
      [projectId, workOrderId],
    );
    if (!result.rowCount) return { version: 0, retainedFrom: 1, lines: [], summary: null };
    const first = result.rows[0],
      lines = result.rows.filter((r) => r.seq !== null).map(entry);
    return {
      version: first.version,
      retainedFrom: lines[0]?.seq ?? first.archived_through + 1,
      lines,
      summary: first.summary as LogSummary | null,
    };
  }
  async read(projectId: string, workOrderId: string, after: number): Promise<readonly LogEntry[]> {
    ids(projectId, workOrderId);
    if (!Number.isSafeInteger(after) || after < 0) throw new SiteLogError('INVALID_LOG');
    return (
      await this.pool.query(
        'SELECT * FROM yard.site_log_lines WHERE project_id=$1 AND work_order_id=$2 AND seq>$3 ORDER BY seq LIMIT 501',
        [projectId, workOrderId, after],
      )
    ).rows.map(entry);
  }
  async archive(now: number, limit: number): Promise<number> {
    if (!time(now) || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new SiteLogError('INVALID_LOG');
    const cutoff = new Date(now - 90 * 86400000);
    const streams = await this.pool.query(
      'SELECT DISTINCT project_id,work_order_id FROM yard.site_log_lines WHERE at<=$1 ORDER BY project_id,work_order_id LIMIT $2',
      [cutoff, limit],
    );
    let archived = 0;
    for (const s of streams.rows) {
      const c = await this.pool.connect();
      try {
        await c.query('BEGIN');
        await c.query('SELECT id FROM yard.projects WHERE id=$1 FOR UPDATE', [s.project_id]);
        const log = await c.query('SELECT * FROM yard.site_logs WHERE project_id=$1 AND work_order_id=$2 FOR UPDATE', [
          s.project_id,
          s.work_order_id,
        ]);
        const counts = await c.query(
          'SELECT kind,count(*)::integer AS count,max(seq)::integer AS through FROM yard.site_log_lines WHERE project_id=$1 AND work_order_id=$2 AND at<=$3 GROUP BY kind',
          [s.project_id, s.work_order_id, cutoff],
        );
        if (counts.rowCount) {
          const old = log.rows[0].summary as LogSummary | null;
          const summary = { through: old?.through ?? 0, count: old?.count ?? 0, kinds: { ...old?.kinds } };
          for (const r of counts.rows) {
            summary.count += r.count;
            summary.through = Math.max(summary.through, r.through);
            summary.kinds[r.kind] = (summary.kinds[r.kind] ?? 0) + r.count;
          }
          await c.query(
            'UPDATE yard.site_logs SET archived_through=$3,summary=$4 WHERE project_id=$1 AND work_order_id=$2',
            [s.project_id, s.work_order_id, summary.through, JSON.stringify(summary)],
          );
          await c.query('DELETE FROM yard.site_log_lines WHERE project_id=$1 AND work_order_id=$2 AND seq<=$3', [
            s.project_id,
            s.work_order_id,
            summary.through,
          ]);
          await c.query("SELECT pg_notify('yard_events',$1)", [`log:${s.project_id}:${s.work_order_id}`]);
          archived++;
        }
        await c.query('COMMIT');
      } catch (error) {
        await c.query('ROLLBACK');
        throw error;
      } finally {
        c.release();
      }
    }
    return archived;
  }
}
