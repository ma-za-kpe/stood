import type pg from 'pg';
import { migrateYardEvents, migrateYardSearch } from './events.js';
import { migrateYardIntakeErasure, migrateYardIntakes } from './intakes.js';
import { migrateYardNotices } from './notices.js';
import { migrateYardCheckpoints, migrateYardPlannerSpend } from './planner-spend.js';
import { provisionYard } from './schema.js';
import { migrateYardSecrets } from './secrets.js';
import { migrateYardSiteLogs } from './site-log.js';

type Roles = Readonly<{ owner: string; runtime: string }>;
const identifier = (s: string) => /^[a-z][a-z0-9_]{0,62}$/.test(s);

// T-0214, operator once: a no-login schema owner and a login runtime role with no other privileges. The connecting
// operator joins the owner role so releases can migrate as it. Existing roles are left as they are.
export async function setupYardRoles(pool: pg.Pool, roles: Roles & Readonly<{ password: string }>) {
  if (!identifier(roles.owner) || !identifier(roles.runtime) || roles.owner === roles.runtime)
    throw new RangeError('Invalid Yard role identities');
  if (roles.password.length < 32 || !/^[A-Za-z0-9_-]+$/.test(roles.password))
    throw new RangeError('Yard runtime password must be at least 32 characters');
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ rolname: string }>('SELECT rolname FROM pg_roles WHERE rolname IN ($1, $2)', [
      roles.owner,
      roles.runtime,
    ]);
    const exists = new Set(rows.map((r) => r.rolname));
    if (!exists.has(roles.owner))
      await client.query(`CREATE ROLE ${roles.owner} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
    if (!exists.has(roles.runtime))
      await client.query(
        `CREATE ROLE ${roles.runtime} LOGIN PASSWORD '${roles.password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
      );
    await client.query(`GRANT ${roles.owner} TO CURRENT_USER`);
  } finally {
    client.release();
  }
}

// T-0214, every release: Yard's schema, idempotently, as the owner role.
export async function migrateYard(pool: pg.Pool, roles: Roles): Promise<void> {
  const client = await pool.connect();
  try {
    await provisionYard(client, roles.owner, roles.runtime);
  } finally {
    client.release();
  }
  await migrateYardEvents(pool, roles.owner);
  await migrateYardIntakes(pool, roles.owner);
  await migrateYardSiteLogs(pool, roles.owner);
  await migrateYardSecrets(pool, roles.owner);
  await migrateYardSearch(pool, roles.owner);
  await migrateYardNotices(pool, roles.owner);
  await migrateYardPlannerSpend(pool, roles.owner);
  await migrateYardCheckpoints(pool, roles.owner);
  await migrateYardIntakeErasure(pool, roles.owner);
}
