import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import type { KeyWrapper } from '../../ports/secrets.js';

// Local/demo key-encryption keys (AES-256-GCM). Live deployments use a KMS adapter behind the same port.
export class LocalKeyWrapper implements KeyWrapper {
  readonly #keys: ReadonlyMap<string, Buffer>;
  readonly #macKey: Buffer;
  constructor(
    keys: Readonly<Record<string, string>>,
    readonly currentId: string,
  ) {
    const entries = Object.entries(keys).map(([id, value]) => {
      const key = Buffer.from(value, 'base64');
      if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(id) || key.length !== 32) throw new RangeError('Invalid key');
      return [id, key] as const;
    });
    this.#keys = new Map(entries);
    const current = this.#keys.get(currentId);
    if (!current) throw new RangeError('Unknown current key');
    this.#macKey = Buffer.from(hkdfSync('sha256', current, Buffer.alloc(0), 'stood-yard-secret-mac', 32));
  }
  wrap(dataKey: Buffer): Readonly<{ wrapped: string; kekId: string }> {
    const kek = this.#keys.get(this.currentId) as Buffer;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', kek, iv);
    cipher.setAAD(Buffer.from(`kek:${this.currentId}`));
    const body = Buffer.concat([cipher.update(dataKey), cipher.final()]);
    return { wrapped: Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64'), kekId: this.currentId };
  }
  unwrap(wrapped: string, kekId: string): Buffer {
    const kek = this.#keys.get(kekId);
    if (!kek) throw new RangeError('Unknown key');
    const raw = Buffer.from(wrapped, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', kek, raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(`kek:${kekId}`));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
  }
  mac(data: string): string {
    return createHmac('sha256', this.#macKey).update(data).digest('hex');
  }
}
