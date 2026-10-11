export type Notice = Readonly<{ key: string; to: string; subject: string; text: string }>;
export interface Notifier {
  // The key goes to the receiver too, so it can drop a repeat: delivery is at least once.
  send(notice: Notice): Promise<void>;
}
// Durable delivery bookkeeping: a per-project event cursor, and each notice key pending, leased or delivered.
export interface NoticeLog {
  cursor(projectId: string): Promise<number>;
  advance(projectId: string, seq: number): Promise<void>;
  // Leases the key to this worker until `now + leaseMs`. DELIVERED: sent before. BUSY: another worker holds a live
  // lease (its send may still fail, so the caller must not treat it as delivered).
  claim(key: string, now: number, leaseMs: number): Promise<'CLAIMED' | 'BUSY' | 'DELIVERED'>;
  // After a successful send. Only this is permanent; a lease that is never delivered expires and is claimed again.
  delivered(key: string, now: number): Promise<void>;
  // Ends a lease when delivery failed, so the next run retries the same key at once.
  release(key: string): Promise<void>;
}
