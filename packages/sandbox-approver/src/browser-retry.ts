// Provider hints are minimum waits: an oversized hint ends this bounded run rather than retrying early.
export function retryDelay(
  attempt: number,
  hint: string | null,
  wallNow: number,
  remaining: number,
  jitter: number,
): number | null {
  const backoff = Math.min(30000, 1000 * 2 ** attempt);
  let minimum = 0;
  const value = hint?.trim() ?? '';
  if (/^\d+$/.test(value)) minimum = Number(value) * 1000;
  else if (/[A-Za-z]/.test(value) && value.endsWith('GMT')) {
    const date = Date.parse(value);
    if (Number.isFinite(date)) minimum = Math.max(0, date - wallNow);
  }
  const delay = Math.ceil(Math.max(minimum, backoff * (0.5 + 0.5 * jitter)));
  return Number.isFinite(delay) && delay < remaining ? delay : null;
}
