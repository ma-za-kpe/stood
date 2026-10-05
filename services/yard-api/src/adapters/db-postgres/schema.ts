import type pg from 'pg';

const identifier = (s: string) => /^[a-z][a-z0-9_]{0,62}$/.test(s);
// Operator-only provisioning: never called by yard-api or with its runtime credentials.
// Roles are pre-created by the database operator; this function creates no passwords.
export async function provisionYard(
  client: Pick<pg.PoolClient, 'query'>,
  owner: string,
  runtime: string,
): Promise<void> {
  if (!identifier(owner) || !identifier(runtime) || owner === runtime)
    throw new RangeError('Invalid Yard role identities');
  await client.query('BEGIN');
  try {
    const { rows } = await client.query(
      'SELECT rolname,rolsuper,rolcreatedb,rolcreaterole,rolbypassrls,rolcanlogin FROM pg_roles WHERE rolname IN ($1,$2)',
      [owner, runtime],
    );
    const ownerRole = rows.find((r) => r.rolname === owner);
    const runtimeRole = rows.find((r) => r.rolname === runtime);
    if (!ownerRole || !runtimeRole || ownerRole.rolcanlogin || !runtimeRole.rolcanlogin)
      throw new Error('Missing separate owner/runtime roles');
    if (rows.some((r) => r.rolsuper || r.rolcreatedb || r.rolcreaterole || r.rolbypassrls))
      throw new Error('Yard roles are privileged');
    const membership = await client.query(
      'SELECT EXISTS(SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=$1)) AS member',
      [runtime],
    );
    if (membership.rows[0].member) throw new Error('Runtime has migration-owner membership');
    const broad = await client.query(
      "SELECT has_schema_privilege($1,'public','CREATE') OR has_database_privilege($1,current_database(),'CREATE') AS ddl",
      [runtime],
    );
    const access = await client.query(
      "SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f') AND has_table_privilege($1,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')",
      [runtime],
    );
    const definer = await client.query(
      "SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef AND has_function_privilege($1,p.oid,'EXECUTE')",
      [runtime],
    );
    if (broad.rows[0].ddl || access.rows.length || definer.rows.length)
      throw new Error('Runtime already has Stood or public DDL permissions');
    const existing = await client.query(
      "SELECT nspowner::regrole::text AS owner FROM pg_namespace WHERE nspname='yard'",
    );
    if (existing.rows.length && existing.rows[0].owner !== owner) throw new Error('Yard schema has another owner');
    await client.query(`CREATE SCHEMA IF NOT EXISTS yard AUTHORIZATION ${owner}`);
    await client.query(`SET LOCAL ROLE ${owner}`);
    await client.query('REVOKE ALL ON SCHEMA yard FROM PUBLIC');
    await client.query(`GRANT USAGE ON SCHEMA yard TO ${runtime}`);
    await client.query(
      'CREATE TABLE IF NOT EXISTS yard.schema_migrations (version integer PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT clock_timestamp())',
    );
    await client.query('INSERT INTO yard.schema_migrations(version) VALUES(0) ON CONFLICT DO NOTHING');
    await client.query(`REVOKE ALL ON yard.schema_migrations FROM ${runtime}`);
    await client.query(`GRANT SELECT ON yard.schema_migrations TO ${runtime}`);
    await client.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA yard GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO ${runtime}`,
    );
    await client.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA yard GRANT USAGE,SELECT ON SEQUENCES TO ${runtime}`,
    );
    await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
