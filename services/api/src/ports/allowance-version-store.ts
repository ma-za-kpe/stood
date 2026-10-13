import type { DraftInput, StoredDraft } from './platform-api-store.js';
export type AllowanceVersion = Readonly<{ version: number; body: StoredDraft }>;
export interface AllowanceVersionStore {
  read(platformId: string, allowanceId: string, version?: number): Promise<AllowanceVersion | null>;
  propose(
    platformId: string,
    allowanceId: string,
    key: string,
    expectedVersion: number,
    input: DraftInput,
  ): Promise<AllowanceVersion>;
}
export class AllowanceVersionError extends Error {
  constructor(readonly code: 'INVALID' | 'NOT_FOUND' | 'STALE_VERSION' | 'IDEMPOTENCY_CONFLICT') {
    super(code);
  }
}
