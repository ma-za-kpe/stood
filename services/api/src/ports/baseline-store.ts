import type { CodeTerms } from '../application/code-terms.js';

// C4 (#77): a baseline proves a milestone's frozen tests are red on the base commit before anyone builds, so the
// tests cannot pass without new work. Requested by a platform, run by Stood's isolated runner.
export type BaselineResult = Readonly<{
  // Every frozen test, in manifest order, as it ran on the base commit.
  tests: readonly Readonly<{ id: string; status: 'PASS' | 'FAIL' }>[];
  // The stored run in Stood's evidence bucket.
  evidence: Readonly<{ key: string; sha256: string }>;
}>;
export type StoredBaseline = Readonly<{
  id: string;
  // QUEUED until the runner has run it; INVALID when the frozen tests are not at the base commit as signed.
  status: 'QUEUED' | 'DONE' | 'INVALID';
  terms: CodeTerms;
  result: BaselineResult | null;
  createdAt: string;
  finishedAt: string | null;
}>;
export type BaselineJob = Readonly<{ id: string; platformId: string; terms: CodeTerms }>;
export interface BaselineStore {
  request(platformId: string, key: string, fingerprint: string, terms: CodeTerms): Promise<StoredBaseline>;
  get(platformId: string, id: string): Promise<StoredBaseline | null>;
  pending(limit: number): Promise<readonly BaselineJob[]>;
  finish(
    id: string,
    outcome: Readonly<{ status: 'DONE'; result: BaselineResult } | { status: 'INVALID' }>,
  ): Promise<void>;
}
export class BaselineStoreError extends Error {
  constructor(readonly code: 'CONFLICT' | 'INVALID') {
    super(code);
  }
}
