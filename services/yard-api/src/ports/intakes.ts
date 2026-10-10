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
export interface IntakeStore {
  load(id: string): Promise<IntakeRecord>;
  save(input: IntakeWrite): Promise<IntakeRecord>;
  read(id: string, after: number): Promise<readonly YardEvent[]>;
  subscribe?(id: string, wake: () => void): Promise<() => void>;
  // T-0217: erase an intake and its history (owner only); list drafts idle since `before`.
  erase?(id: string, owner: string, reason: 'BUYER_REQUEST' | 'EXPIRED', now: number): Promise<'ERASED' | 'ALREADY'>;
  idle?(before: number, limit?: number): Promise<readonly Readonly<{ id: string; owner: string }>[]>;
}
