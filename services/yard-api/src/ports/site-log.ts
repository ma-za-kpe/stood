import type { SiteLogLine } from '@stood/yard-contracts';
import type { YardSnapshot } from './events.js';
export type LogEntry = Readonly<{
  seq: number;
  actor: string;
  at: string;
  line: SiteLogLine;
}>;
export type LogSummary = Readonly<{ through: number; count: number; kinds: Readonly<Record<string, number>> }>;
export type LogSnapshot = Readonly<{
  version: number;
  retainedFrom: number;
  lines: readonly LogEntry[];
  summary: LogSummary | null;
}>;
export type LogWrite = Readonly<{
  projectId: string;
  workOrderId: string;
  actor: string;
  key: string;
  lines: readonly SiteLogLine[];
  now: number;
  // Called under the same project row lock used by claims, expiry and submissions.
  authorize(snapshot: YardSnapshot): void;
}>;
export type LogReceipt = Readonly<{ version: number; count: number; accepted: true }>;
export interface SiteLogs {
  append(write: LogWrite): Promise<LogReceipt>;
  bounds(projectId: string, workOrderId: string): Promise<Readonly<{ version: number; retainedFrom: number }>>;
  snapshot(projectId: string, workOrderId: string): Promise<LogSnapshot>;
  read(projectId: string, workOrderId: string, after: number): Promise<readonly LogEntry[]>;
  subscribe(projectId: string, workOrderId: string, wake: () => void): Promise<() => void>;
  archive(now: number, limit: number): Promise<number>;
}
export interface LogScanner {
  safe(text: string): Promise<boolean>;
}
export class SiteLogError extends Error {
  constructor(readonly code: 'INVALID_LOG' | 'SECRET_IN_LOG' | 'SCAN_UNAVAILABLE' | 'RATE_LIMITED') {
    super(code);
  }
}
