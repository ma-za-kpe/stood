import type { NoticeLog, Notifier } from '../ports/notifications.js';
import type { Board } from './board.js';

// Delivers each derived notice exactly once. A project's cursor advances only after all its event
// notices were delivered; a failed send releases its key so the next run retries it.
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
        if (!(await log.claim(n.key))) continue;
        try {
          await notifier.send({ key: n.key, to, subject: n.subject, text: n.text });
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
