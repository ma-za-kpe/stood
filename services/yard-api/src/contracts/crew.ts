export type CrewOffer = Readonly<{
  id: string;
  repository: string;
  baseCommit: string;
  stack: string;
  priceMinor: number;
}>;
export type CrewLease = Readonly<{ id: string; expiresAt: number; token: string }>;
export interface CrewBoard {
  discover(ids?: readonly string[]): Promise<readonly CrewOffer[]>;
  claim(
    id: string,
    builder: Readonly<{ builderId: string; operatorId: string; operatorRootId: string }>,
  ): Promise<CrewLease>;
  log(
    id: string,
    lease: string,
    event: Readonly<{ seq: number; at: string; kind: string; message: string; simulated: true }>,
  ): Promise<void>;
  submit(id: string, lease: string, commit: string, idempotencyKey: string): Promise<void>;
  clockOut(id: string, lease: string): Promise<void>;
  status(id: string): Promise<'SUBMITTED' | 'PUNCH_LIST'>;
}
