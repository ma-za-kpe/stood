import type pg from 'pg';
import {
  type SecretAudit,
  type SecretCommand,
  SecretError,
  type SecretRow,
  type SecretRows,
} from '../../ports/secrets.js';

// Operator-run migration. The runtime role can write ciphertext rows but cannot alter audit history.
export async function migrateYardSecrets(pool: pg.Pool, owner: string): Promise<void> {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(owner)) throw new RangeError('Invalid Yard owner');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SET LOCAL ROLE ${owner}`);
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended('yard-secrets-migration',0))");
    if ((await c.query('SELECT 1 FROM yard.schema_migrations WHERE version=5')).rowCount) {
      await c.query('COMMIT');
      return;
    }
    await c.query(`CREATE TABLE yard.secrets (
      blueprint_id text NOT NULL CHECK(blueprint_id ~ '^[A-Za-z0-9_-]{1,100}$'),
      owner text NOT NULL CHECK(length(owner)>0),
      name text NOT NULL CHECK(name ~ '^[A-Z][A-Z0-9_]{0,63}$'),
      provider text NOT NULL CHECK(length(provider) BETWEEN 1 AND 40),
      environment text NOT NULL CHECK(environment IN ('TEST','DEV')),
      version integer NOT NULL CHECK(version>0),
      ciphertext text NOT NULL, wrapped_key text NOT NULL, kek_id text NOT NULL,
      fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{16}$'),
      created_at bigint NOT NULL CHECK(created_at>=0),
      revoked_at bigint CHECK(revoked_at IS NULL OR revoked_at>=created_at),
      delete_at bigint,
      PRIMARY KEY(blueprint_id,name,version),
      -- A revoked row holds no key material: revocation is crypto-shredding.
      CHECK((revoked_at IS NULL AND length(ciphertext)>0 AND length(wrapped_key)>0) OR
            (revoked_at IS NOT NULL AND ciphertext='' AND wrapped_key='')));
      CREATE UNIQUE INDEX secrets_one_active ON yard.secrets(blueprint_id,name) WHERE revoked_at IS NULL;
      CREATE TABLE yard.secret_commands (
        blueprint_id text NOT NULL, key text NOT NULL CHECK(length(key) BETWEEN 1 AND 200),
        fingerprint text NOT NULL, result jsonb NOT NULL, PRIMARY KEY(blueprint_id,key));
      CREATE TABLE yard.secret_audit (
        blueprint_id text NOT NULL, name text NOT NULL, version integer NOT NULL,
        deploy_id text NOT NULL CHECK(deploy_id ~ '^[A-Za-z0-9_-]{1,100}$'), at bigint NOT NULL);
      CREATE TRIGGER secret_command_immutable BEFORE UPDATE OR DELETE ON yard.secret_commands FOR EACH ROW EXECUTE FUNCTION yard.immutable_event();
      CREATE TRIGGER secret_audit_immutable BEFORE UPDATE OR DELETE ON yard.secret_audit FOR EACH ROW EXECUTE FUNCTION yard.immutable_event();
      CREATE TRIGGER secret_audit_no_truncate BEFORE TRUNCATE ON yard.secret_audit FOR EACH STATEMENT EXECUTE FUNCTION yard.immutable_event();
      INSERT INTO yard.schema_migrations(version) VALUES(5);`);
    await c.query('COMMIT');
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally {
    c.release();
  }
}
const row = (r: Record<string, unknown>): SecretRow =>
  Object.freeze({
    blueprintId: String(r.blueprint_id),
    owner: String(r.owner),
    name: String(r.name),
    provider: String(r.provider),
    environment: r.environment as SecretRow['environment'],
    version: Number(r.version),
    ciphertext: String(r.ciphertext),
    wrappedKey: String(r.wrapped_key),
    kekId: String(r.kek_id),
    fingerprint: String(r.fingerprint),
    createdAt: Number(r.created_at),
    revokedAt: r.revoked_at === null ? null : Number(r.revoked_at),
    deleteAt: r.delete_at === null ? null : Number(r.delete_at),
  });
export class PostgresSecretRows implements SecretRows {
  constructor(private readonly pool: pg.Pool) {}
  async command(blueprintId: string, key: string): Promise<SecretCommand | null> {
    const { rows } = await this.pool.query(
      'SELECT key,fingerprint,result FROM yard.secret_commands WHERE blueprint_id=$1 AND key=$2',
      [blueprintId, key],
    );
    return rows[0] ? { key: rows[0].key, fingerprint: rows[0].fingerprint, result: rows[0].result } : null;
  }
  async write(r: SecretRow, command: SecretCommand): Promise<void> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`secret:${r.blueprintId}:${r.name}`]);
      await c.query('INSERT INTO yard.secret_commands VALUES($1,$2,$3,$4)', [
        r.blueprintId,
        command.key,
        command.fingerprint,
        JSON.stringify(command.result),
      ]);
      await c.query(
        "UPDATE yard.secrets SET revoked_at=$3, ciphertext='', wrapped_key='' WHERE blueprint_id=$1 AND name=$2 AND revoked_at IS NULL",
        [r.blueprintId, r.name, r.createdAt],
      );
      await c.query('INSERT INTO yard.secrets VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NULL,NULL)', [
        r.blueprintId,
        r.owner,
        r.name,
        r.provider,
        r.environment,
        r.version,
        r.ciphertext,
        r.wrappedKey,
        r.kekId,
        r.fingerprint,
        r.createdAt,
      ]);
      await c.query('COMMIT');
    } catch (error) {
      await c.query('ROLLBACK');
      // A racing writer took this version or command key first.
      if ((error as { code?: string }).code === '23505') throw new SecretError('CONFLICT');
      throw error;
    } finally {
      c.release();
    }
  }
  async owner(blueprintId: string): Promise<string | null> {
    const { rows } = await this.pool.query('SELECT owner FROM yard.secrets WHERE blueprint_id=$1 LIMIT 1', [
      blueprintId,
    ]);
    return rows[0]?.owner ?? null;
  }
  async active(blueprintId: string): Promise<readonly SecretRow[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM yard.secrets WHERE blueprint_id=$1 AND revoked_at IS NULL ORDER BY name',
      [blueprintId],
    );
    return rows.map(row);
  }
  async current(blueprintId: string, name: string): Promise<SecretRow | null> {
    const { rows } = await this.pool.query(
      'SELECT * FROM yard.secrets WHERE blueprint_id=$1 AND name=$2 ORDER BY version DESC LIMIT 1',
      [blueprintId, name],
    );
    return rows[0] ? row(rows[0]) : null;
  }
  async revoke(blueprintId: string, name: string, at: number): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      "UPDATE yard.secrets SET revoked_at=$3, ciphertext='', wrapped_key='' WHERE blueprint_id=$1 AND name=$2 AND revoked_at IS NULL",
      [blueprintId, name, at],
    );
    return (rowCount ?? 0) > 0;
  }
  async schedule(blueprintId: string, deleteAt: number): Promise<void> {
    await this.pool.query('UPDATE yard.secrets SET delete_at=$2 WHERE blueprint_id=$1', [blueprintId, deleteAt]);
  }
  async purge(now: number): Promise<number> {
    const { rowCount } = await this.pool.query(
      'DELETE FROM yard.secrets WHERE delete_at IS NOT NULL AND delete_at<=$1',
      [now],
    );
    return rowCount ?? 0;
  }
  async audit(entry: SecretAudit): Promise<void> {
    await this.pool.query('INSERT INTO yard.secret_audit VALUES($1,$2,$3,$4,$5)', [
      entry.blueprintId,
      entry.name,
      entry.version,
      entry.deployId,
      entry.at,
    ]);
  }
  async rewrapped(r: SecretRow, wrappedKey: string, kekId: string): Promise<void> {
    await this.pool.query(
      'UPDATE yard.secrets SET wrapped_key=$4, kek_id=$5 WHERE blueprint_id=$1 AND name=$2 AND version=$3 AND revoked_at IS NULL AND kek_id=$6',
      [r.blueprintId, r.name, r.version, wrappedKey, kekId, r.kekId],
    );
  }
  async wrappedBy(kekId: string, limit: number): Promise<readonly SecretRow[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM yard.secrets WHERE kek_id=$1 AND revoked_at IS NULL ORDER BY blueprint_id,name LIMIT $2',
      [kekId, limit],
    );
    return rows.map(row);
  }
  async keyIdsInUse(): Promise<readonly string[]> {
    const { rows } = await this.pool.query('SELECT DISTINCT kek_id FROM yard.secrets WHERE revoked_at IS NULL');
    return rows.map((r) => String(r.kek_id));
  }
}
