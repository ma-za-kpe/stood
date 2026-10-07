import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { SECRET_PROVIDERS } from '@stood/yard-contracts';
import {
  type KeyWrapper,
  type SecretEnvironment,
  SecretError,
  type SecretMeta,
  type SecretRow,
  type SecretRows,
} from '../ports/secrets.js';

export { SECRET_PROVIDERS } from '@stood/yard-contracts';

// Self-identifying live credentials. Patterns cannot prove a key is test-only; they only refuse obvious live ones.
const LIVE = [/\b[spr]k_live_/i, /\bFLWSECK-(?!TEST)/, /\bFLWPUBK-(?!TEST)/, /\bsk-live-/i];
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
export type PutSecret = Readonly<{
  blueprintId: string;
  owner: string;
  provider: string;
  name: string;
  environment: SecretEnvironment;
  value: string;
  key: string;
  now: number;
}>;
const aad = (row: Pick<SecretRow, 'blueprintId' | 'name' | 'environment' | 'version'>) =>
  Buffer.from(JSON.stringify(['stood-yard-secret@1', row.blueprintId, row.name, row.environment, row.version]));
const meta = (row: SecretRow): SecretMeta =>
  Object.freeze({
    name: row.name,
    provider: row.provider,
    environment: row.environment,
    version: row.version,
    fingerprint: row.fingerprint,
    createdAt: row.createdAt,
  });
export class SecretVault {
  constructor(
    private readonly rows: SecretRows,
    private readonly keys: KeyWrapper,
  ) {}
  async put(input: PutSecret): Promise<SecretMeta> {
    if (
      !text(input.blueprintId, 100) ||
      !/^[A-Za-z0-9_-]{1,100}$/.test(input.blueprintId) ||
      !text(input.owner, 200) ||
      !SECRET_PROVIDERS.includes(input.provider) ||
      !/^[A-Z][A-Z0-9_]{0,63}$/.test(input.name) ||
      !['TEST', 'DEV'].includes(input.environment) ||
      !text(input.value, 8192) ||
      !text(input.key, 200) ||
      !Number.isSafeInteger(input.now) ||
      input.now < 0
    )
      throw new SecretError('INVALID');
    const normalised = input.value.normalize('NFKC');
    if (LIVE.some((pattern) => pattern.test(normalised))) throw new SecretError('LIVE_KEY');
    const owner = await this.rows.owner(input.blueprintId);
    if (owner !== null && owner !== input.owner) throw new SecretError('FORBIDDEN');
    const request = this.keys.mac(
      JSON.stringify([input.owner, input.provider, input.name, input.environment, input.value]),
    );
    const previous = await this.rows.command(input.blueprintId, input.key);
    if (previous) {
      if (previous.fingerprint !== request) throw new SecretError('CONFLICT');
      return previous.result;
    }
    const version = ((await this.rows.current(input.blueprintId, input.name))?.version ?? 0) + 1;
    const dataKey = randomBytes(32);
    const iv = randomBytes(12);
    const identity = { blueprintId: input.blueprintId, name: input.name, environment: input.environment, version };
    const cipher = createCipheriv('aes-256-gcm', dataKey, iv);
    cipher.setAAD(aad(identity));
    const body = Buffer.concat([cipher.update(input.value, 'utf8'), cipher.final()]);
    const wrapped = this.keys.wrap(dataKey);
    const row: SecretRow = Object.freeze({
      ...identity,
      owner: input.owner,
      provider: input.provider,
      ciphertext: Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64'),
      wrappedKey: wrapped.wrapped,
      kekId: wrapped.kekId,
      fingerprint: createHmac('sha256', dataKey).update(input.value).digest('hex').slice(0, 16),
      createdAt: input.now,
      revokedAt: null,
      deleteAt: null,
    });
    dataKey.fill(0);
    const result = meta(row);
    await this.rows.write(row, { key: input.key, fingerprint: request, result });
    return result;
  }
  async list(blueprintId: string, owner: string): Promise<readonly SecretMeta[]> {
    await this.owned(blueprintId, owner);
    return (await this.rows.active(blueprintId)).map(meta);
  }
  async revoke(blueprintId: string, owner: string, name: string, now: number): Promise<void> {
    await this.owned(blueprintId, owner);
    if (!Number.isSafeInteger(now) || !(await this.rows.revoke(blueprintId, name, now)))
      throw new SecretError('NOT_FOUND');
  }
  async scheduleDeletion(blueprintId: string, owner: string, deleteAt: number): Promise<void> {
    await this.owned(blueprintId, owner);
    if (!Number.isSafeInteger(deleteAt) || deleteAt < 0) throw new SecretError('INVALID');
    await this.rows.schedule(blueprintId, deleteAt);
  }
  purge(now: number): Promise<number> {
    if (!Number.isSafeInteger(now)) throw new SecretError('INVALID');
    return this.rows.purge(now);
  }
  // Only the preview-deploy job calls this. Every decrypt is audited before the value is returned.
  async decryptForDeploy(blueprintId: string, name: string, use: Readonly<{ deployId: string; now: number }>) {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(use.deployId ?? '') || !Number.isSafeInteger(use.now))
      throw new SecretError('INVALID');
    const row = await this.rows.current(blueprintId, name);
    if (!row || row.revokedAt !== null) throw new SecretError('NOT_FOUND');
    let value: string;
    try {
      const dataKey = this.keys.unwrap(row.wrappedKey, row.kekId);
      const raw = Buffer.from(row.ciphertext, 'base64');
      const decipher = createDecipheriv('aes-256-gcm', dataKey, raw.subarray(0, 12));
      decipher.setAAD(aad(row));
      decipher.setAuthTag(raw.subarray(12, 28));
      value = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
      dataKey.fill(0);
    } catch {
      throw new SecretError('UNAVAILABLE');
    }
    await this.rows.audit({ blueprintId, name, version: row.version, deployId: use.deployId, at: use.now });
    return value;
  }
  // Re-wraps data keys under the current key-encryption key, so an old key can be retired.
  async rewrap(now: number, limit = 100): Promise<number> {
    if (!Number.isSafeInteger(now)) throw new SecretError('INVALID');
    let count = 0;
    for (const kekId of await this.oldKeyIds()) {
      for (const row of await this.rows.wrappedBy(kekId, limit)) {
        const dataKey = this.keys.unwrap(row.wrappedKey, row.kekId);
        const next = this.keys.wrap(dataKey);
        dataKey.fill(0);
        await this.rows.rewrapped(row, next.wrapped, next.kekId);
        count++;
      }
    }
    return count;
  }
  private async oldKeyIds(): Promise<string[]> {
    return (await this.rows.keyIdsInUse()).filter((id) => id !== this.keys.currentId);
  }
  private async owned(blueprintId: string, owner: string): Promise<void> {
    const current = await this.rows.owner(blueprintId);
    if (current !== null && current !== owner) throw new SecretError('FORBIDDEN');
  }
}
