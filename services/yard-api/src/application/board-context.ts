import type { YardEvents, YardSnapshot } from '../ports/events.js';
import type { Data, Operator } from './board-state.js';

// Core project mutation and ownership rules shared by the feature services. Bound callbacks preserve the
// Board facade's retry, idempotency and actor checks; features never import the facade itself.
export interface BoardContext {
  readonly events: YardEvents;
  readonly limits: Readonly<{ maxActiveClaims: number; payee?: string; feeBps?: number }>;
  mutate(
    id: string,
    actor: Operator,
    version: number,
    key: string,
    command: unknown,
    type: string,
    change: (data: Data) => unknown,
  ): Promise<YardSnapshot>;
  atCurrent<T>(id: string, write: (version: number) => Promise<T>): Promise<T>;
  activeClaims(root: string, now: number, except?: Readonly<{ id: string; wo: string }>): Promise<number>;
  read(id: string, actor: Operator): Promise<YardSnapshot>;
  submit(
    id: string,
    wo: string,
    commit: string,
    packageId: string,
    actor: Operator,
    version: number,
    key: string,
    now: number,
  ): Promise<YardSnapshot>;
}
