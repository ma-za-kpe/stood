import type { NoticeLog } from '../../src/ports/notifications.js';

export class MemoryNoticeLog implements NoticeLog {
  #cursors = new Map<string, number>();
  #keys = new Map<string, { leasedUntil: number; delivered: boolean }>();
  async cursor(projectId: string) {
    return this.#cursors.get(projectId) ?? 0;
  }
  async advance(projectId: string, seq: number) {
    this.#cursors.set(projectId, Math.max(seq, this.#cursors.get(projectId) ?? 0));
  }
  async claim(key: string, now: number, leaseMs: number) {
    const row = this.#keys.get(key);
    if (row?.delivered) return 'DELIVERED' as const;
    if (row && row.leasedUntil > now) return 'BUSY' as const;
    this.#keys.set(key, { leasedUntil: now + leaseMs, delivered: false });
    return 'CLAIMED' as const;
  }
  async delivered(key: string) {
    this.#keys.set(key, { leasedUntil: 0, delivered: true });
  }
  async release(key: string) {
    const row = this.#keys.get(key);
    if (row && !row.delivered) row.leasedUntil = 0;
  }
}
