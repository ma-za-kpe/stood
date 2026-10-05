import type { PaymentOperation, ReauthorizationOperation } from '../domain/tranche.js';

export type OperationIntent = PaymentOperation | ReauthorizationOperation;
export type OperationStatus = 'RESERVED' | 'AMBIGUOUS' | 'CONFIRMED' | 'FAILED';
export type StoredOperation = Readonly<{
  trancheId: string;
  operation: OperationIntent;
  providerRequestId: string;
  status: OperationStatus;
  reference: string | null;
  version: number;
  reservedFromVersion: number;
  createdAt: string;
}>;
export type OperationEvent = Readonly<{
  trancheId: string;
  key: string;
  version: number;
  status: OperationStatus;
  reference: string | null;
  recordedAt: string;
}>;
export interface PaymentOperationStore {
  createStream(trancheId: string): Promise<void>;
  reserve(trancheId: string, expectedVersion: number, operation: OperationIntent): Promise<StoredOperation>;
  load(trancheId: string, key: string): Promise<StoredOperation | null>;
  recordOutcome(
    trancheId: string,
    expectedVersion: number,
    key: string,
    status: Exclude<OperationStatus, 'RESERVED'>,
    reference: string | null,
  ): Promise<StoredOperation>;
  history(trancheId: string): Promise<readonly OperationEvent[]>;
}
