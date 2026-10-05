export type YardSnapshot = Readonly<{ id: string; owner: string; version: number; data: unknown }>;
export type YardEvent = Readonly<{ seq: number; type: string; payload: unknown; actor: string; at: string }>;
export type Mutation = Readonly<{ data: unknown; type: string; payload: unknown }>;
export class YardError extends Error {
  constructor(readonly code: 'CONFLICT' | 'STALE_VERSION' | 'NOT_FOUND' | 'FORBIDDEN' | 'INVALID') {
    super(code);
  }
}
export interface YardEvents {
  create(id: string, owner: string, data: unknown, key: string): Promise<YardSnapshot>;
  load(id: string): Promise<YardSnapshot>;
  list(after?: string): Promise<readonly YardSnapshot[]>;
  read(id: string, after: number): Promise<readonly YardEvent[]>;
  mutate(
    id: string,
    version: number,
    actor: string,
    key: string,
    fingerprint: string,
    change: (data: unknown) => Mutation,
  ): Promise<YardSnapshot>;
}
