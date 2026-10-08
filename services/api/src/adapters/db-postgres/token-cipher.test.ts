import { randomBytes } from 'node:crypto';
import { expect, it } from 'vitest';
import { TokenCipher } from './token-cipher.js';

const key = () => randomBytes(32).toString('base64');
const v1 = key(),
  v2 = key();

it('seals a saved PayPal token so only the same row can open it, and never shows it (T-0227)', () => {
  const cipher = new TokenCipher(`v1:${v1}`);
  const sealed = cipher.seal('TOKEN-123', 'mandate-a');
  expect(sealed).toMatch(/^v1\./);
  expect(sealed).not.toContain('TOKEN-123');
  expect(cipher.seal('TOKEN-123', 'mandate-a')).not.toBe(sealed);
  expect(cipher.open(sealed, 'mandate-a')).toBe('TOKEN-123');
  expect(() => cipher.open(sealed, 'mandate-b')).toThrow('Token cannot be opened');
  const [version, iv, body, tag] = sealed.split('.');
  const flipped = `${body?.[0] === 'A' ? 'B' : 'A'}${body?.slice(1)}`;
  expect(() => cipher.open([version, iv, flipped, tag].join('.'), 'mandate-a')).toThrow('Token cannot be opened');
  expect(() => cipher.open('TOKEN-123', 'mandate-a')).toThrow('Token cannot be opened');
  expect(cipher.fingerprint('TOKEN-123')).toBe(cipher.fingerprint('TOKEN-123'));
  expect(cipher.fingerprint('TOKEN-123')).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(cipher)).not.toContain(v1);
});

it('rotates: the first key seals, older keys still open, and unknown versions fail closed', () => {
  const old = new TokenCipher(`v1:${v1}`);
  const sealed = old.seal('TOKEN-9', 'm');
  const rotated = new TokenCipher(`v2:${v2},v1:${v1}`);
  expect(rotated.open(sealed, 'm')).toBe('TOKEN-9');
  expect(rotated.current(sealed)).toBe(false);
  const resealed = rotated.seal('TOKEN-9', 'm');
  expect(resealed).toMatch(/^v2\./);
  expect(rotated.current(resealed)).toBe(true);
  expect(() => old.open(resealed, 'm')).toThrow('Token cannot be opened');
});

it('refuses unsafe key lists without echoing them', () => {
  for (const bad of ['', 'v1', `v1:${randomBytes(16).toString('base64')}`, `v1:${v1},v1:${v2}`, `x:${v1}`, `v1:${v1},`])
    expect(() => new TokenCipher(bad)).toThrow(/^VAULT_TOKEN_KEYS must be/);
  try {
    new TokenCipher(`v1:${v1},v1:${v2}`);
  } catch (error) {
    expect(String(error)).not.toContain(v1);
  }
});
