import { createSign } from 'node:crypto';

type Config = Readonly<{
  appId: string;
  // PEM of the GitHub App's private key.
  privateKey: string;
  installationId: string;
  fetch?: typeof globalThis.fetch;
  clock?: () => number;
}>;
const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

// #77 operations: the reconciler reads builders' repositories with short-lived installation tokens from the Yard
// GitHub App instead of a 90-day personal token. Each token may only read contents and metadata, lasts at most an
// hour, and is renewed five minutes before it expires. Any failure is REPOSITORY_UNAVAILABLE, so a package waits.
export function githubAppToken(config: Config): () => Promise<string> {
  const http = config.fetch ?? fetch;
  const clock = config.clock ?? Date.now;
  if (!/^\d{1,20}$/.test(config.appId) || !/^\d{1,20}$/.test(config.installationId) || !config.privateKey.trim())
    throw new Error('GITHUB_APP_INVALID');
  let cached: { value: string; renewAt: number } | null = null;
  let pending: Promise<string> | null = null;
  const issue = async () => {
    const now = Math.floor(clock() / 1000);
    const unsigned = `${part({ alg: 'RS256', typ: 'JWT' })}.${part({ iat: now - 60, exp: now + 540, iss: config.appId })}`;
    const jwt = `${unsigned}.${createSign('RSA-SHA256').update(unsigned).sign(config.privateKey, 'base64url')}`;
    const response = await http(`https://api.github.com/app/installations/${config.installationId}/access_tokens`, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${jwt}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ permissions: { contents: 'read', metadata: 'read' } }),
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status !== 201) throw new Error('REPOSITORY_UNAVAILABLE');
    const body = (await response.json()) as { token?: unknown; expires_at?: unknown };
    const expiresAt = Math.min(Date.parse(String(body.expires_at)) || 0, clock() + 3_600_000);
    if (typeof body.token !== 'string' || !body.token || expiresAt - 300_000 <= clock())
      throw new Error('REPOSITORY_UNAVAILABLE');
    cached = { value: body.token, renewAt: expiresAt - 300_000 };
    return body.token;
  };
  return async () => {
    if (cached && clock() < cached.renewAt) return cached.value;
    // Concurrent reads share one request.
    pending ??= issue().finally(() => {
      pending = null;
    });
    try {
      return await pending;
    } catch {
      throw new Error('REPOSITORY_UNAVAILABLE');
    }
  };
}
