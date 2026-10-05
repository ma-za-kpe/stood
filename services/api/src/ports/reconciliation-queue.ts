export type ReconciliationJob = Readonly<{ trancheId: string; token: string }>;
export type OperationalAlert = Readonly<{
  trancheId: string;
  operationKey: string | null;
  code: 'PROVIDER_UNKNOWN' | 'UNRESOLVED_3H' | 'SAFE_CANCEL_REQUESTED' | 'WORKER_FAILURE';
  owner: string;
}>;
export interface ReconciliationQueue {
  seed(): Promise<void>;
  claim(): Promise<ReconciliationJob | null>;
  finish(job: ReconciliationJob, delaySeconds: number): Promise<void>;
  alert(alert: OperationalAlert): Promise<void>;
  resolve(trancheId: string): Promise<void>;
}
