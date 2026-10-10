// C4 (#77): durable, Stood-only evidence storage. Objects are written once and addressed by their own hash, so a
// retry stores the same bytes at the same key and nothing already stored can be replaced.
export type StoredEvidence = Readonly<{ key: string; sha256: string; bytes: number }>;
export interface EvidenceStore {
  put(prefix: string, body: Buffer, contentType: string): Promise<StoredEvidence>;
  get(key: string): Promise<Buffer | null>;
}
export class EvidenceStoreError extends Error {
  constructor(readonly code: 'INVALID_KEY' | 'UNAVAILABLE' | 'CONFLICT') {
    super(`EVIDENCE_${code}`);
  }
}
