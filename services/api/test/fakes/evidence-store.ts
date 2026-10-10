import { createHash } from 'node:crypto';
import { type EvidenceStore, EvidenceStoreError, type StoredEvidence } from '../../src/ports/evidence-store.js';

// In-memory evidence bucket with the same write-once, hash-addressed contract as S3EvidenceStore.
export class MemoryEvidence implements EvidenceStore {
  readonly objects = new Map<string, Buffer>();
  down = false;
  async put(prefix: string, body: Buffer): Promise<StoredEvidence> {
    if (this.down) throw new EvidenceStoreError('UNAVAILABLE');
    const sha256 = createHash('sha256').update(body).digest('hex');
    const key = `${prefix}/${sha256}`;
    this.objects.set(key, Buffer.from(body));
    return { key, sha256, bytes: body.length };
  }
  async get(key: string): Promise<Buffer | null> {
    if (this.down) throw new EvidenceStoreError('UNAVAILABLE');
    return this.objects.get(key) ?? null;
  }
}
