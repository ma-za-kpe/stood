import type { StoredOperation } from './payment-operation-store.js';

// Normalised lookup proof, not an execution response. The adapter must prove the
// request identity and completeness; a timeout or a PENDING result is not proof.
export interface ProviderStatusReader {
  read(operation: StoredOperation): Promise<unknown>;
}
