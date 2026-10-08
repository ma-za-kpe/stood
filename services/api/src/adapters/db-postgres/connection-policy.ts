// T-0254: how Stood may reach its database outside local development and CI. Returns a reason (never
// containing the URL, which holds a password) or null when the URL is acceptable.
const LOCAL_ENVIRONMENTS = new Set(['local', 'ci']);

export function databaseUrlProblem(url: string, appEnv: string): string | null {
  if (LOCAL_ENVIRONMENTS.has(appEnv)) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'DATABASE_URL is not a valid URL';
  }
  // verify-full checks the server certificate and the hostname; require would accept any certificate.
  if (parsed.searchParams.get('sslmode') !== 'verify-full') return 'DATABASE_URL must use sslmode=verify-full';
  if (parsed.hostname.split('.')[0]?.endsWith('-pooler'))
    return 'DATABASE_URL must be the direct (unpooled) host: Stood uses LISTEN';
  return null;
}
