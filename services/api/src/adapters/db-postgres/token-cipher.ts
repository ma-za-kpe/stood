import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

// T-0227: saved PayPal tokens are a standing permission to charge a buyer, so they are sealed at rest with
// AES-256-GCM. The mandate key is the associated data: a sealed token opens only on its own row. Keys come from
// VAULT_TOKEN_KEYS ("v2:<base64>,v1:<base64>"): the first seals, every listed key opens, so rotation is
// "add a new key first, re-seal, then drop the old one".
const FORMAT = 'VAULT_TOKEN_KEYS must be "v<n>:<base64 32-byte key>" entries, comma-separated, unique versions';
export class TokenCipher {
  readonly #keys: ReadonlyMap<string, Buffer>;
  readonly #current: string;

  constructor(list: string) {
    const keys = new Map<string, Buffer>();
    for (const entry of list.split(',')) {
      const [version, encoded, extra] = entry.trim().split(':');
      const key = Buffer.from(encoded ?? '', 'base64');
      if (!/^v[1-9]\d{0,5}$/.test(version ?? '') || extra !== undefined || key.length !== 32 || keys.has(version ?? ''))
        throw new Error(FORMAT);
      keys.set(version as string, key);
    }
    this.#keys = keys;
    this.#current = [...keys.keys()][0] as string;
  }

  seal(token: string, rowKey: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.#keys.get(this.#current) as Buffer, iv);
    cipher.setAAD(Buffer.from(rowKey));
    const body = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    return [this.#current, iv, body, cipher.getAuthTag()]
      .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
      .join('.');
  }

  open(sealed: string, rowKey: string): string {
    try {
      const [version, iv, body, tag, extra] = sealed.split('.');
      const key = this.#keys.get(version ?? '');
      if (!key || extra !== undefined) throw new Error();
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv ?? '', 'base64url'));
      decipher.setAAD(Buffer.from(rowKey));
      decipher.setAuthTag(Buffer.from(tag ?? '', 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(body ?? '', 'base64url')), decipher.final()]).toString('utf8');
    } catch {
      throw new Error('Token cannot be opened');
    }
  }

  // Sealed under the newest key?
  current(sealed: string): boolean {
    return sealed.startsWith(`${this.#current}.`);
  }

  // One token, one mandate: PayPal token ids are long random values, so a plain hash cannot be reversed.
  fingerprint(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  toJSON() {
    return { versions: [...this.#keys.keys()] };
  }
}
