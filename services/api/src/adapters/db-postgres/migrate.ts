import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

// T-0253: apply pending Drizzle migrations and report how many were new. Safe to run on every release:
// Drizzle records applied migrations in drizzle.__drizzle_migrations and skips them next time.
export async function applyMigrations(url: string, folder: string): Promise<Readonly<{ applied: number }>> {
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    const count = async (): Promise<number> => {
      const exists = await pool.query("SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS ok");
      if (!exists.rows[0]?.ok) return 0;
      return Number((await pool.query('SELECT count(*) AS n FROM drizzle.__drizzle_migrations')).rows[0]?.n ?? 0);
    };
    const before = await count();
    await migrate(drizzle(pool), { migrationsFolder: folder });
    return { applied: (await count()) - before };
  } finally {
    await pool.end();
  }
}
