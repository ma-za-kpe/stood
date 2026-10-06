import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MemorySecretRows } from '../../test/fakes/secrets.js';
import { LocalKeyWrapper } from '../adapters/crypto/local-key-wrapper.js';
import { SecretError } from '../ports/secrets.js';
import { SecretVault } from './secret-vault.js';

const at = 1791158400000;
const kek = () => randomBytes(32).toString('base64');
function vault(keys = { k1: kek() }, current = 'k1') {
  const rows = new MemorySecretRows();
  const wrapper = new LocalKeyWrapper(keys, current);
  return { rows, wrapper, vault: new SecretVault(rows, wrapper) };
}
const input = {
  blueprintId: 'bp',
  owner: 'buyer',
  provider: 'supabase',
  name: 'SUPABASE_URL',
  environment: 'TEST' as const,
  value: 'https://dev-project.supabase.co',
  key: 'put-1',
  now: at,
};

describe('Write-only test-key vault (T-0227, T-0195)', () => {
  it('stores ciphertext only, returns metadata without the value, and is idempotent per command key', async () => {
    const f = vault();
    const meta = await f.vault.put(input);
    expect(meta).toMatchObject({ name: 'SUPABASE_URL', provider: 'supabase', environment: 'TEST', version: 1 });
    expect(meta.fingerprint).toMatch(/^[a-f0-9]{16}$/);
    expect(JSON.stringify(meta)).not.toContain('dev-project');
    expect(JSON.stringify(f.rows.dump())).not.toContain('dev-project');
    expect(await f.vault.put(input)).toEqual(meta);
    await expect(f.vault.put({ ...input, value: 'https://other.supabase.co' })).rejects.toThrow('CONFLICT');
    const list = await f.vault.list('bp', 'buyer');
    expect(list).toEqual([meta]);
    expect(Object.keys(list[0] ?? {})).not.toContain('value');
  });
  it('replaces a secret by name with a new version and keeps only the latest active', async () => {
    const f = vault();
    await f.vault.put(input);
    const second = await f.vault.put({ ...input, key: 'put-2', value: 'https://dev-2.supabase.co', now: at + 1 });
    expect(second.version).toBe(2);
    expect(await f.vault.list('bp', 'buyer')).toEqual([second]);
    expect(await f.vault.decryptForDeploy('bp', 'SUPABASE_URL', { deployId: 'preview-1', now: at + 2 })).toBe(
      'https://dev-2.supabase.co',
    );
  });
  it('refuses live, unscoped and malformed credentials with fixed codes and never echoes them', async () => {
    const f = vault();
    for (const [patch, code] of [
      [{ value: `sk_live_${'a'.repeat(24)}` }, 'LIVE_KEY'],
      [{ value: `rk_live_${'a'.repeat(24)}` }, 'LIVE_KEY'],
      [{ value: `FLWSECK-${'a'.repeat(32)}-X` }, 'LIVE_KEY'],
      [{ environment: 'PROD' }, 'INVALID'],
      [{ name: 'lower_case' }, 'INVALID'],
      [{ provider: 'unknown-cloud' }, 'INVALID'],
      [{ value: '' }, 'INVALID'],
      [{ value: 'x'.repeat(8193) }, 'INVALID'],
      [{ owner: '' }, 'INVALID'],
    ] as const) {
      const error = await f.vault.put({ ...input, ...patch } as never).catch((e) => e);
      expect(error).toBeInstanceOf(SecretError);
      expect(error.code).toBe(code);
      expect(String(error.message)).not.toContain('aaaa');
    }
    expect(await f.vault.list('bp', 'buyer')).toEqual([]);
  });
  it('lets only the owner list or revoke, and a revoked secret can never be decrypted', async () => {
    const f = vault();
    await f.vault.put(input);
    await expect(f.vault.list('bp', 'intruder')).rejects.toThrow('FORBIDDEN');
    await expect(f.vault.revoke('bp', 'intruder', 'SUPABASE_URL', at + 1)).rejects.toThrow('FORBIDDEN');
    await f.vault.revoke('bp', 'buyer', 'SUPABASE_URL', at + 1);
    expect(await f.vault.list('bp', 'buyer')).toEqual([]);
    await expect(
      f.vault.decryptForDeploy('bp', 'SUPABASE_URL', { deployId: 'preview-1', now: at + 2 }),
    ).rejects.toThrow('NOT_FOUND');
    expect(JSON.stringify(f.rows.dump())).not.toMatch(/"ciphertext":"[A-Za-z0-9+/=]{8,}"/);
  });
  it('audits every decrypt with the deploy id and never records the value', async () => {
    const f = vault();
    await f.vault.put(input);
    await f.vault.decryptForDeploy('bp', 'SUPABASE_URL', { deployId: 'preview-1', now: at + 5 });
    await expect(f.vault.decryptForDeploy('bp', 'SUPABASE_URL', { deployId: '', now: at + 5 })).rejects.toThrow(
      'INVALID',
    );
    expect(f.rows.audited()).toEqual([
      { blueprintId: 'bp', name: 'SUPABASE_URL', version: 1, deployId: 'preview-1', at: at + 5 },
    ]);
  });
  it('rejects swapped or tampered ciphertext through authenticated binding', async () => {
    const f = vault();
    await f.vault.put(input);
    await f.vault.put({ ...input, key: 'other', name: 'SUPABASE_ANON_KEY', value: 'anon-public-key-value' });
    f.rows.swapCiphertext('bp', 'SUPABASE_URL', 'SUPABASE_ANON_KEY');
    await expect(f.vault.decryptForDeploy('bp', 'SUPABASE_URL', { deployId: 'p', now: at + 1 })).rejects.toThrow(
      'UNAVAILABLE',
    );
  });
  it('rotates the key-encryption key: new writes use the new key, rewrap leaves every value readable', async () => {
    const keys = { k1: kek(), k2: kek() };
    const first = vault({ k1: keys.k1 }, 'k1');
    await first.vault.put(input);
    const rotated = new SecretVault(first.rows, new LocalKeyWrapper(keys, 'k2'));
    expect(await rotated.rewrap(at + 1)).toBe(1);
    expect(first.rows.dump().every((r) => r.kekId === 'k2')).toBe(true);
    const onlyNew = new SecretVault(first.rows, new LocalKeyWrapper({ k2: keys.k2 }, 'k2'));
    expect(await onlyNew.decryptForDeploy('bp', 'SUPABASE_URL', { deployId: 'p', now: at + 2 })).toBe(input.value);
  });
  it('deletes every secret at the scheduled time after handover', async () => {
    const f = vault();
    await f.vault.put(input);
    await f.vault.scheduleDeletion('bp', 'buyer', at + 7 * 86400000);
    expect(await f.vault.purge(at + 7 * 86400000 - 1)).toBe(0);
    expect(await f.vault.purge(at + 7 * 86400000)).toBe(1);
    expect(await f.vault.list('bp', 'buyer')).toEqual([]);
    expect(f.rows.dump()).toEqual([]);
  });
});

describe('Local key wrapper', () => {
  it('requires 32-byte keys, a known current id and refuses unknown ids', () => {
    expect(() => new LocalKeyWrapper({ k1: Buffer.alloc(16).toString('base64') }, 'k1')).toThrow();
    expect(() => new LocalKeyWrapper({ k1: kek() }, 'k2')).toThrow();
    expect(() => new LocalKeyWrapper({ 'bad id': kek() }, 'bad id')).toThrow();
    const w = new LocalKeyWrapper({ k1: kek() }, 'k1');
    const dek = randomBytes(32);
    const wrapped = w.wrap(dek);
    expect(wrapped.kekId).toBe('k1');
    expect(w.unwrap(wrapped.wrapped, 'k1').equals(dek)).toBe(true);
    expect(() => w.unwrap(wrapped.wrapped, 'k9')).toThrow();
  });
});
