import type { NoticeLog, Notifier } from '../ports/notifications.js';
import type { Board } from './board.js';

// Delivers each derived notice at least once, with its key so the receiver can drop a repeat (fifth audit, 2026-10-11:
// "exactly once" was not true). A key is leased, then marked delivered only after the send succeeded; a crash leaves
// the lease to expire and the key is sent again. A project's cursor advances only when every notice is delivered:
// a failed send, or another worker's live lease, holds it back.
export const NOTICE_LEASE_MS = 5 * 60_000;
export async function notifyAll(
  board: Board,
  log: NoticeLog,
  notifier: Notifier,
  contacts: Readonly<Record<string, string>>,
  now: number,
) {
  const result = { sent: 0, failed: 0, skipped: 0 };
  let after = '';
  do {
    const projects = await board.events.list(after);
    const page = projects.slice(0, 100);
    for (const project of page) {
      const { notices, lastSeq } = await board.notices(project.id, await log.cursor(project.id), now);
      let delivered = true;
      for (const n of notices) {
        const to = contacts[n.actor];
        if (!to) {
          result.skipped++;
          continue;
        }
        const claim = await log.claim(n.key, now, NOTICE_LEASE_MS);
        if (claim === 'DELIVERED') continue;
        if (claim === 'BUSY') {
          delivered = false;
          continue;
        }
        try {
          await notifier.send({ key: n.key, to, subject: n.subject, text: n.text });
          await log.delivered(n.key, now);
          result.sent++;
        } catch {
          await log.release(n.key);
          result.failed++;
          delivered = false;
        }
      }
      if (delivered) await log.advance(project.id, lastSeq);
    }
    after = projects.length > 100 ? (page.at(-1)?.id ?? '') : '';
  } while (after);
  return result;
}
