import type pg from 'pg';

const identifier = (s: string) => /^[a-z][a-z0-9_]{0,62}$/.test(s);
// Operator-only provisioning: never called by yard-api or with its runtime credentials.
// Roles are pre-created by the database operator; this function creates no passwords.
export async function provisionYard(
  client: Pick<pg.PoolClient, 'query'>,
  owner: string,
  runtime: string,
  runtimeLogin = runtime,
): Promise<void> {
  if (
    !identifier(owner) ||
    !identifier(runtime) ||
    !identifier(runtimeLogin) ||
    owner === runtime ||
    owner === runtimeLogin
  )
    throw new RangeError('Invalid Yard role identities');
  await client.query('BEGIN');
  try {
    const { rows } = await client.query(
      'SELECT rolname,rolsuper,rolcreatedb,rolcreaterole,rolbypassrls,rolcanlogin FROM pg_roles WHERE rolname = ANY($1::text[])',
      [[...new Set([owner, runtime, runtimeLogin])]],
    );
    const ownerRole = rows.find((r) => r.rolname === owner);
    const runtimeRole = rows.find((r) => r.rolname === runtime);
    const runtimeLoginRole = rows.find((r) => r.rolname === runtimeLogin);
    if (
      !ownerRole ||
      !runtimeRole ||
      !runtimeLoginRole ||
      ownerRole.rolcanlogin ||
      (runtime === runtimeLogin ? !runtimeRole.rolcanlogin : runtimeRole.rolcanlogin || !runtimeLoginRole.rolcanlogin)
    )
      throw new Error('Missing separate owner/runtime roles');
    if (
      [ownerRole, runtimeRole, runtimeLoginRole].some(
        (r) => r.rolsuper || r.rolcreatedb || r.rolcreaterole || r.rolbypassrls,
      )
    )
      throw new Error('Yard roles are privileged');
    const membership = await client.query(
      `SELECT member.rolname AS member, parent.rolname AS role
       FROM pg_auth_members m
       JOIN pg_roles parent ON parent.oid=m.roleid
       JOIN pg_roles member ON member.oid=m.member
       WHERE member.rolname IN ($1,$2)`,
      [runtimeLogin, runtime],
    );
    const loginRoles = membership.rows.filter((r) => r.member === runtimeLogin).map((r) => r.role);
    const runtimeParents = membership.rows.filter((r) => r.member === runtime).map((r) => r.role);
    if (loginRoles.includes(owner) || runtimeParents.includes(owner))
      throw new Error('Runtime has migration-owner membership');
    if (runtimeParents.length) throw new Error('Runtime role has unrelated role membership');
    if (runtime === runtimeLogin ? loginRoles.length > 0 : loginRoles.some((r) => r !== runtime))
      throw new Error('Runtime login has unrelated role membership');
    if (runtime !== runtimeLogin && !loginRoles.includes(runtime))
      throw new Error('Runtime login is not a member of its restricted role');
    const broad = await client.query(
      "SELECT has_schema_privilege($1,'public','CREATE') OR has_database_privilege($1,current_database(),'CREATE') AS ddl",
      [runtimeLogin],
    );
    const access = await client.query(
      "SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f') AND has_table_privilege($1,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')",
      [runtimeLogin],
    );
    const definer = await client.query(
      "SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef AND has_function_privilege($1,p.oid,'EXECUTE')",
      [runtimeLogin],
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
