// Audit 2026-10-10, finding 4: a run (a baseline, or one decision on a code package) is claimed before it starts, so
// two reconcilers never run the same job, and a job that keeps waiting backs off instead of starving newer ones.
export type RunKind = 'baseline' | 'package';
export type ClaimState = Readonly<{ attempts: number; due: boolean }>;
export interface RunClaims {
  // Jobs with a claim row; a job without one has never been tried and is due.
  states(kind: RunKind, ids: readonly string[]): Promise<ReadonlyMap<string, ClaimState>>;
  // Atomically takes a lease on a due job: the attempt number, or null when another runner holds it or it is backing off.
  claim(kind: RunKind, id: string, leaseMs: number): Promise<number | null>;
  // Ends the lease. A job that finished is forgotten; one that waited is due again after a backoff, with its reason.
  release(kind: RunKind, id: string, waited: string | null): Promise<void>;
}
