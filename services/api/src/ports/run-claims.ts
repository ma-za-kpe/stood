// Audit 2026-10-10, finding 4: a run (a baseline, or one decision on a code package) is claimed before it starts, so
// two reconcilers never run the same job, and a job that keeps waiting backs off instead of starving newer ones.
export type RunKind = 'baseline' | 'package';
export type ClaimState = Readonly<{ attempts: number; due: boolean }>;
export interface RunClaims {
  // Jobs with a claim row; a job without one has never been tried and is due.
  states(kind: RunKind, ids: readonly string[]): Promise<ReadonlyMap<string, ClaimState>>;
  // Atomically takes a lease on a due job: the attempt number and a token proving ownership of this attempt, or null
  // when another runner holds it or it is backing off.
  claim(kind: RunKind, id: string, leaseMs: number): Promise<Readonly<{ attempts: number; token: string }> | null>;
  // Second audit (2026-10-11): extends a lease still owned (same token); false when it was lost to another runner.
  renew(kind: RunKind, id: string, token: string, leaseMs: number): Promise<boolean>;
  // Ends the lease, only for its owner. A job that finished is forgotten; one that waited is due again after a backoff,
  // with its reason. A runner whose lease was taken over changes nothing.
  release(kind: RunKind, id: string, token: string, waited: string | null): Promise<void>;
}
