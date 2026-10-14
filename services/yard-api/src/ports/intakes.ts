import type { IntakeDraft } from '@stood/yard-contracts';
import type { YardEvent } from './events.js';
export type IntakeRecord = Readonly<{
  id: string;
  owner: string;
  version: number;
  step: number;
  draft: IntakeDraft;
  createdAt: number;
  updatedAt: number;
}>;
export type IntakeWrite = Readonly<{
  id: string;
  owner: string;
  key: string;
  expectedVersion: number;
  step: number;
  draft: unknown;
  now: number;
}>;
export type IntakePlanLock<T> = Readonly<{ linked: false } | { linked: true; value: T }>;
export interface IntakeStore {
  load(id: string): Promise<IntakeRecord>;
  // Holds the same per-intake advisory lock used by save for the full async operation.
  withLock?<T>(id: string, run: () => Promise<T>): Promise<T>;
  // Resolves the plan's source intake, then holds its deletion fence while the project is created.
  withPlanLock?<T>(planId: string, run: () => Promise<T>): Promise<IntakePlanLock<T>>;
  registerPlan?(id: string, owner: string, version: number, planId: string): Promise<void>;
  assertNotErasing?(id: string): Promise<void>;
  prepareErasure?(
    id: string,
    owner: string,
    reason: 'BUYER_REQUEST' | 'EXPIRED',
    now: number,
    planIds: readonly string[],
    eligibleBefore?: number,
  ): Promise<boolean>;
  pendingErasureTargets?(id: string): Promise<readonly string[]>;
  completeErasureTarget?(id: string, planId: string): Promise<void>;
  save(input: IntakeWrite): Promise<IntakeRecord>;
  read(id: string, after: number): Promise<readonly YardEvent[]>;
  subscribe?(id: string, wake: () => void): Promise<() => void>;
  // T-0217: erase an intake and its history (owner only); list drafts idle since `before`.
  erase?(
    id: string,
    owner: string,
    reason: 'BUYER_REQUEST' | 'EXPIRED',
    now: number,
    eligibleBefore?: number,
  ): Promise<'ERASED' | 'ALREADY' | 'FRESH'>;
  idle?(
    before: number,
    limit?: number,
    after?: Readonly<{ updatedAt: number; id: string }>,
  ): Promise<readonly Readonly<{ id: string; owner: string; updatedAt: number }>[]>;
}
