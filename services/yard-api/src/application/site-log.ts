import { type SiteLogLine, siteLogBatchChecked } from '@stood/yard-contracts';
import type { LogScanner, SiteLogs } from '../ports/site-log.js';
import { SiteLogError } from '../ports/site-log.js';
import type { Board, Operator } from './board.js';

export class SiteLog {
  constructor(
    readonly store: SiteLogs,
    private readonly board: Board,
    private readonly scanner: LogScanner,
  ) {}
  async append(projectId: string, workOrderId: string, actor: Operator, key: string, value: unknown, now: number) {
    if (actor.kind !== 'BUILDER') throw new SiteLogError('INVALID_LOG');
    let lines: readonly SiteLogLine[];
    try {
      lines = siteLogBatchChecked(value);
    } catch {
      throw new SiteLogError('INVALID_LOG');
    }
    // Never call a scanner or send private text before establishing the caller's scope.
    this.board.logScope(await this.board.events.load(projectId), workOrderId, actor, now, true);
    for (const line of lines) {
      let safe: boolean;
      try {
        safe = await this.scanner.safe(JSON.stringify(line));
      } catch {
        throw new SiteLogError('SCAN_UNAVAILABLE');
      }
      if (safe !== true) throw new SiteLogError('SECRET_IN_LOG');
    }
    return this.store.append({
      projectId,
      workOrderId,
      actor: actor.id,
      key,
      lines,
      now,
      authorize: (snapshot) => this.board.logScope(snapshot, workOrderId, actor, now, true),
    });
  }
  async snapshot(projectId: string, workOrderId: string, actor: Operator, now: number) {
    this.board.logScope(await this.board.events.load(projectId), workOrderId, actor, now, false);
    return this.store.snapshot(projectId, workOrderId);
  }
  async authorize(projectId: string, workOrderId: string, actor: Operator, now: number) {
    this.board.logScope(await this.board.events.load(projectId), workOrderId, actor, now, false);
  }
}
