import type { StoredTranche } from './tranche-store.js';
export type DraftInput = Readonly<{
  payee_ref: string;
  cap: Readonly<{ minor: number; currency: string }>;
  milestones: readonly Readonly<{
    name: string;
    amount: Readonly<{ minor: number; currency: string }>;
    profile: string;
    params: Readonly<Record<string, unknown>>;
  }>[];
  window_days: number;
  max_resubmits: number;
}>;
export type StoredDraft = DraftInput &
  Readonly<{ id: string; status: 'DRAFT'; tranches: readonly Readonly<{ id: string; name: string }>[] }>;
export interface PlatformApiStore {
  create(platformId: string, key: string, fingerprint: string, input: DraftInput): Promise<StoredDraft>;
  allowance(platformId: string, id: string): Promise<StoredDraft | null>;
  tranche(platformId: string, id: string): Promise<StoredTranche | null>;
}
export class PlatformApiStoreError extends Error {
  readonly code = 'IDEMPOTENCY_CONFLICT';
  constructor() {
    super('IDEMPOTENCY_CONFLICT');
  }
}
