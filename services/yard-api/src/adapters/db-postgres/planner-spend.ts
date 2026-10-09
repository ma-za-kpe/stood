import type { SpendGuard } from '@stood/yard-foreman';
import type pg from 'pg';

const DAY = 86_400_000;

// Operator-run migration 8: the Foreman's daily planner spend, in US dollar micros (T-0181).
export async function migrateYardPlannerSpend(pool: pg.Pool, owner: string): Promise<void> {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(owner)) throw new RangeError('Invalid Yard owner');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SET LOCAL ROLE ${owner}`);
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended('yard-planner-spend-migration',0))");
    if (!(await c.query('SELECT 1 FROM yard.schema_migrations WHERE version=8')).rowCount)
      await c.query(`CREATE TABLE yard.planner_spend (
          day integer PRIMARY KEY, used bigint NOT NULL CHECK(used>=0));
        INSERT INTO yard.schema_migrations(version) VALUES(8);`);
    await c.query('COMMIT');
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally {
    c.release();
  }
}

// The budget holds across restarts and replicas: a reservation is one conditional UPDATE on today's row.
export class PostgresPlannerSpend implements SpendGuard {
  constructor(
    private readonly pool: pg.Pool,
    private readonly dailyMicros: number,
    private readonly clock: () => number = Date.now,
  ) {}
  private today() {
    return Math.floor(this.clock() / DAY);
  }
  async reserve(micros: number): Promise<boolean> {
    const day = this.today();
    await this.pool.query('INSERT INTO yard.planner_spend VALUES($1,0) ON CONFLICT DO NOTHING', [day]);
    const { rowCount } = await this.pool.query(
      'UPDATE yard.planner_spend SET used=used+$2 WHERE day=$1 AND used+$2<=$3',
      [day, micros, this.dailyMicros],
    );
    return (rowCount ?? 0) === 1;
  }
  async settle(reserved: number, actual: number): Promise<void> {
    await this.pool.query('UPDATE yard.planner_spend SET used=GREATEST(0, used-$2+$3) WHERE day=$1', [
      this.today(),
      reserved,
      actual,
    ]);
  }
  async spent(): Promise<number> {
    const { rows } = await this.pool.query('SELECT used FROM yard.planner_spend WHERE day=$1', [this.today()]);
    return rows[0] ? Number(rows[0].used) : 0;
  }
}
