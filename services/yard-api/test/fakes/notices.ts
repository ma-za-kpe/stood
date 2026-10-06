import type { NoticeLog } from '../../src/ports/notifications.js';

export class MemoryNoticeLog implements NoticeLog {
  #cursors = new Map<string, number>();
  #sent = new Set<string>();
  async cursor(projectId: string) {
    return this.#cursors.get(projectId) ?? 0;
  }
  async advance(projectId: string, seq: number) {
    this.#cursors.set(projectId, Math.max(seq, this.#cursors.get(projectId) ?? 0));
  }
  async claim(key: string) {
    if (this.#sent.has(key)) return false;
    this.#sent.add(key);
    return true;
  }
  async release(key: string) {
    this.#sent.delete(key);
  }
}
