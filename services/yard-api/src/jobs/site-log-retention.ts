import type { SiteLogs } from '../ports/site-log.js';
// Local composition only; durable rows make each bounded sweep restart-safe.
// Hosted job ownership/readiness is tracked separately in T-0214.
export function startLogRetention(
  store: Pick<SiteLogs, 'archive'>,
  clock: () => Promise<number>,
  report: (code: 'site_log_retention_unavailable') => void,
) {
  let busy = false,
    stopped = false;
  const run = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      await store.archive(await clock(), 100);
    } catch {
      report('site_log_retention_unavailable');
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void run(), 60000);
  timer.unref();
  return {
    run,
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}
