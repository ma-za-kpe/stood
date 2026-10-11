import { createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { githubAppToken } from './app-token.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const start = Date.parse('2026-10-10T12:00:00Z');

function harness(answers: { status: number; body: unknown }[]) {
  let now = start;
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = answers.shift() ?? { status: 500, body: {} };
    return new Response(JSON.stringify(next.body), { status: next.status });
  });
  const token = githubAppToken({
    appId: '5230872',
    privateKey: pem,
    installationId: '169056228',
    fetch,
    clock: () => now,
  });
  return { token, calls, advance: (ms: number) => (now += ms) };
}
const issued = (token: string, minutes = 60) => ({
  status: 201,
  body: { token, expires_at: new Date(start + minutes * 60_000).toISOString() },
});

// #77 operations: short-lived, read-only installation tokens replace the 90-day personal token.
describe('githubAppToken', () => {
  it('asks GitHub for a read-only installation token, signed by the App, and reuses it until near expiry', async () => {
    const h = harness([issued('ghs_first'), issued('ghs_second', 120)]);
    const [a, b] = await Promise.all([h.token(), h.token()]);
    expect([a, b]).toEqual(['ghs_first', 'ghs_first']);
    expect(h.calls).toHaveLength(1);
    const call = h.calls[0] as { url: string; init: RequestInit };
    expect(call.url).toBe('https://api.github.com/app/installations/169056228/access_tokens');
    expect(JSON.parse(String(call.init.body))).toEqual({ permissions: { contents: 'read', metadata: 'read' } });
    const jwt = String((call.init.headers as Record<string, string>).Authorization).replace('Bearer ', '');
    const [header, payload, signature] = jwt.split('.') as [string, string, string];
    expect(createVerify('RSA-SHA256').update(`${header}.${payload}`).verify(publicKey, signature, 'base64url')).toBe(
      true,
    );
    expect(JSON.parse(Buffer.from(payload, 'base64url').toString())).toMatchObject({ iss: '5230872' });
    h.advance(54 * 60_000);
    expect(await h.token()).toBe('ghs_first');
    h.advance(2 * 60_000);
    expect(await h.token()).toBe('ghs_second');
  });

  it('is unavailable, never a guess, when GitHub refuses or answers oddly, and tries again next time', async () => {
    const h = harness([
      { status: 401, body: { message: 'Bad credentials' } },
      { status: 201, body: { token: '', expires_at: new Date(start + 3_600_000).toISOString() } },
      issued('ghs_ok'),
    ]);
    await expect(h.token()).rejects.toThrow('REPOSITORY_UNAVAILABLE');
    await expect(h.token()).rejects.toThrow('REPOSITORY_UNAVAILABLE');
    expect(await h.token()).toBe('ghs_ok');
    expect(() => githubAppToken({ appId: 'x', privateKey: pem, installationId: '1' })).toThrow('GITHUB_APP_INVALID');
  });
});
