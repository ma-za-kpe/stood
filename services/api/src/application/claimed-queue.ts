import type { RunClaims, RunKind } from '../ports/run-claims.js';

// A lease lasts 15 minutes and is renewed every 5 while its run is still working, up to an overall deadline of 45
// minutes (repository reads plus a ten-minute sandbox fit well inside). After that it is no longer renewed, so another
// runner can take the job over; a late finisher cannot decide twice (decisions are idempotent and bound to the
// latest package).
export const RUN_LEASE_MS = 15 * 60_000;
export const RUN_RENEW_MS = 5 * 60_000;
export const RUN_DEADLINE_MS = 45 * 60_000;

// Audit 2026-10-10, finding 4: runs up to `limit` due jobs, fewest attempts first (oldest first among equals), each
// under a claim. Two stuck jobs at the head of the queue no longer block every job behind them, and a job another
// runner is running is skipped, not run twice.
export async function runClaimed<J>(
  claims: RunClaims,
  kind: RunKind,
  queue: readonly J[],
  idOf: (job: J) => string,
  limit: number,
  run: (job: J, signal: AbortSignal) => Promise<string>,
): Promise<readonly Readonly<{ id: string; outcome: string }>[]> {
  const states = await claims.states(kind, queue.map(idOf));
  const due = queue
    .map((job, age) => ({ job, age, state: states.get(idOf(job)) }))
    .filter((c) => c.state?.due ?? true)
    .sort((a, b) => (a.state?.attempts ?? 0) - (b.state?.attempts ?? 0) || a.age - b.age);
  const done: { id: string; outcome: string }[] = [];
  for (const { job } of due) {
    if (done.length >= limit) break;
    const id = idOf(job);
    const lease = await claims.claim(kind, id, RUN_LEASE_MS);
    if (lease === null) continue;
    const started = Date.now();
    const heartbeat = setInterval(() => {
      if (Date.now() - started >= RUN_DEADLINE_MS) clearInterval(heartbeat);
      else claims.renew(kind, id, lease.token, RUN_LEASE_MS).catch(() => undefined);
    }, RUN_RENEW_MS);
    heartbeat.unref?.();
    // Fifth audit (2026-10-11): the deadline ends the wait, not just the renewals. The run is told to abort (the
    // sandbox is stopped) and the queue moves on; a late finisher cannot decide twice.
    const controller = new AbortController();
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let outcome: string;
    try {
      outcome = await Promise.race([
        run(job, controller.signal).catch(() => 'WAIT:FAILED'),
        new Promise<string>((resolve) => {
          deadline = setTimeout(() => {
            controller.abort();
            resolve('WAIT:DEADLINE');
          }, RUN_DEADLINE_MS);
          deadline.unref?.();
        }),
      ]);
    } finally {
      clearInterval(heartbeat);
      clearTimeout(deadline);
    }
    await claims.release(kind, id, lease.token, outcome.startsWith('WAIT') ? outcome : null);
    done.push({ id, outcome });
  }
  return done;
}
