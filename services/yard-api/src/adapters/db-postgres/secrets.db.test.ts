import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { yardDatabase } from '../../../test/database.js';
import { SecretVault } from '../../application/secret-vault.js';
import { LocalKeyWrapper } from '../crypto/local-key-wrapper.js';
import { migrateYardEvents } from './events.js';
import { migrateYardSecrets, PostgresSecretRows } from './secrets.js';

let f: Awaited<ReturnType<typeof yardDatabase>>;
const at = 1791158400000;
const keys = { k1: randomBytes(32).toString('base64'), k2: randomBytes(32).toString('base64') };
const input = {
  blueprintId: 'bp',
  owner: 'buyer',
  provider: 'supabase',
  name: 'SUPABASE_SERVICE_ROLE',
  environment: 'DEV' as const,
  value: 'dev-project-service-role-value',
  key: 'put-1',
  now: at,
};
beforeAll(async () => {
  f = await yardDatabase();
  await migrateYardEvents(f.pool, f.owner);
  await migrateYardSecrets(f.pool, f.owner);
  await migrateYardSecrets(f.pool, f.owner); // idempotent
});
afterAll(async () => {
  if (f) await f.close();
});
it('stores only ciphertext under the runtime role, audits decrypts and survives a reconnect (T-0227)', async () => {
  const vault = new SecretVault(new PostgresSecretRows(f.limited), new LocalKeyWrapper(keys, 'k1'));
  const meta = await vault.put(input);
  expect(await vault.put(input)).toEqual(meta);
  const raw = await f.pool.query('SELECT * FROM yard.secrets');
  expect(JSON.stringify(raw.rows)).not.toContain('service-role-value');
  const connection = f.connectRuntime();
  try {
    const restored = new SecretVault(new PostgresSecretRows(connection), new LocalKeyWrapper(keys, 'k1'));
    expect(await restored.list('bp', 'buyer')).toEqual([meta]);
    expect(await restored.decryptForDeploy('bp', input.name, { deployId: 'preview-1', now: at + 1 })).toBe(input.value);
  } finally {
    await connection.end();
  }
  const audit = await f.pool.query('SELECT * FROM yard.secret_audit');
  expect(audit.rows).toEqual([
    { blueprint_id: 'bp', name: input.name, version: 1, deploy_id: 'preview-1', at: String(at + 1) },
  ]);
  // The runtime role cannot rewrite or erase who decrypted what.
  await expect(f.limited.query("UPDATE yard.secret_audit SET deploy_id='forged'")).rejects.toThrow();
  await expect(f.limited.query('DELETE FROM yard.secret_audit')).rejects.toThrow();
  await expect(f.limited.query('TRUNCATE yard.secret_audit')).rejects.toThrow();
});
it('serialises racing replacements, crypto-shreds on revoke and refuses key material on revoked rows', async () => {
  const vault = new SecretVault(new PostgresSecretRows(f.limited), new LocalKeyWrapper(keys, 'k1'));
  const results = await Promise.allSettled([
    vault.put({ ...input, key: 'race-a', value: 'value-a-123' }),
    vault.put({ ...input, key: 'race-b', value: 'value-b-456' }),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
  const active = await f.pool.query('SELECT version FROM yard.secrets WHERE name=$1 AND revoked_at IS NULL', [
    input.name,
  ]);
  expect(active.rows).toHaveLength(1);
  await vault.revoke('bp', 'buyer', input.name, at + 10);
  const shredded = await f.pool.query('SELECT ciphertext, wrapped_key FROM yard.secrets WHERE name=$1', [input.name]);
  expect(shredded.rows.every((r) => r.ciphertext === '' && r.wrapped_key === '')).toBe(true);
  await expect(
    f.limited.query("UPDATE yard.secrets SET ciphertext='x' WHERE name=$1 AND revoked_at IS NOT NULL", [input.name]),
  ).rejects.toThrow();
});
it('rewraps under a rotated key and purges everything after the handover deadline', async () => {
  const rows = new PostgresSecretRows(f.limited);
  const old = new SecretVault(rows, new LocalKeyWrapper({ k1: keys.k1 }, 'k1'));
  await old.put({
    ...input,
    blueprintId: 'bp2',
    name: 'RESEND_API_KEY',
    provider: 'resend',
    value: 're_test_value',
    key: 'p',
  });
  const rotated = new SecretVault(rows, new LocalKeyWrapper(keys, 'k2'));
  expect(await rotated.rewrap(at + 1)).toBeGreaterThanOrEqual(1);
  const onlyNew = new SecretVault(rows, new LocalKeyWrapper({ k2: keys.k2 }, 'k2'));
  expect(await onlyNew.decryptForDeploy('bp2', 'RESEND_API_KEY', { deployId: 'p', now: at + 2 })).toBe('re_test_value');
  await onlyNew.scheduleDeletion('bp2', 'buyer', at + 7 * 86400000);
  expect(await onlyNew.purge(at + 7 * 86400000)).toBe(1);
  expect(await onlyNew.list('bp2', 'buyer')).toEqual([]);
});
