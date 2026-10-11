import type { RateLimiter } from '../ports/rate-limiter.js';

// T-0156: limits on the signed platform API, per minute. A platform's writes and reads are counted apart, so a burst
// of reads never blocks a funding request; failed sign-ins are counted per client address, so guessing a key is slow.
export const RATE_WINDOW_MS = 60_000;
export const RATE_LIMITS = { write: 120, read: 600, failedAuth: 30 } as const;

export type RateCheck = Readonly<{ limited: false } | { limited: true; retryAfterSeconds: number }>;
const windowOf = (now: number) => Math.floor(now / RATE_WINDOW_MS) * RATE_WINDOW_MS;
const limited = (now: number): RateCheck => ({
  limited: true,
  retryAfterSeconds: Math.max(1, Math.ceil((windowOf(now) + RATE_WINDOW_MS - now) / 1000)),
});

// Storage trouble never blocks the payment API: the limit is abuse protection, not a money guard. It is reported.
async function safely(work: () => Promise<RateCheck>, report: (reason: string) => void): Promise<RateCheck> {
  try {
    return await work();
  } catch (error) {
    report(error instanceof Error ? error.message.slice(0, 120) : 'unknown');
    return { limited: false };
  }
}

// Before authentication: is this client address already over its failed sign-ins for this minute?
export const signInBlocked = (limiter: RateLimiter, client: string, now: number, report: (r: string) => void) =>
  safely(async () => {
    const failures = await limiter.hit(`auth:${client}`, 0, windowOf(now));
    return failures >= RATE_LIMITS.failedAuth ? limited(now) : { limited: false };
  }, report);

export const signInFailed = (limiter: RateLimiter, client: string, now: number, report: (r: string) => void) =>
  safely(async () => {
    await limiter.hit(`auth:${client}`, 1, windowOf(now));
    return { limited: false };
  }, report);

// After authentication: one request against the platform's write or read budget.
export const platformRequest = (
  limiter: RateLimiter,
  platformId: string,
  write: boolean,
  now: number,
  report: (r: string) => void,
) =>
  safely(async () => {
    const kind = write ? 'write' : 'read';
    const count = await limiter.hit(`platform:${platformId}:${kind}`, 1, windowOf(now));
    return count > RATE_LIMITS[kind] ? limited(now) : { limited: false };
  }, report);
