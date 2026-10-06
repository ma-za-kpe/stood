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
}
