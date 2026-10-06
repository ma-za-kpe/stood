export type Notice = Readonly<{ key: string; to: string; subject: string; text: string }>;
export interface Notifier {
  send(notice: Notice): Promise<void>;
}
// Durable delivery bookkeeping: a per-project event cursor and the keys already sent.
export interface NoticeLog {
  cursor(projectId: string): Promise<number>;
  advance(projectId: string, seq: number): Promise<void>;
  // Returns false if the key was already recorded (another worker sent it).
  claim(key: string): Promise<boolean>;
  // Undo a claim when delivery failed, so a later run retries the same key.
  release(key: string): Promise<void>;
}
