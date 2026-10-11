import type { SiteLogs } from '../ports/site-log.js';
import { repeat } from './repeat.js';
// Durable rows make each bounded sweep restart-safe. Callers run it once at start; it repeats a minute after each pass.
export function startLogRetention(
  store: Pick<SiteLogs, 'archive'>,
  clock: () => Promise<number>,
  report: (code: 'site_log_retention_unavailable') => void,
) {
  return repeat(
    async () => {
      await store.archive(await clock(), 100);
    },
    60000,
    () => report('site_log_retention_unavailable'),
  );
}
