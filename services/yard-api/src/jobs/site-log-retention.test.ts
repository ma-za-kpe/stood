import { afterEach, expect, it, vi } from 'vitest';
import { startLogRetention } from './site-log-retention.js';

afterEach(() => vi.useRealTimers());
it('uses the configured shared clock, bounds work and prevents overlapping runs', async () => {
  vi.useFakeTimers();
  let now = 1000,
    finish: (v: number) => void = () => {};
  const store = {
    archive: vi.fn(
      () =>
        new Promise<number>((resolve) => {
          finish = resolve;
        }),
    ),
  };
  const clock = vi.fn(async () => now),
    report = vi.fn();
  const job = startLogRetention(store, clock, report);
  const run = job.run();
  await Promise.resolve();
  expect(store.archive).toHaveBeenCalledWith(1000, 100);
  await vi.advanceTimersByTimeAsync(60000);
  expect(store.archive).toHaveBeenCalledTimes(1);
  finish(1);
  await run;
  now = 2000;
  await vi.advanceTimersByTimeAsync(60000);
  expect(store.archive).toHaveBeenLastCalledWith(2000, 100);
  finish(0);
  await Promise.resolve();
  job.stop();
  await vi.advanceTimersByTimeAsync(120000);
  expect(store.archive).toHaveBeenCalledTimes(2);
  expect(report).not.toHaveBeenCalled();
});
it('reports only a static failure code and retries after the next tick', async () => {
  vi.useFakeTimers();
  const store = { archive: vi.fn().mockRejectedValueOnce(new Error('secret diagnostic')).mockResolvedValue(0) };
  const report = vi.fn();
  const job = startLogRetention(store, async () => 1000, report);
  await job.run();
  expect(report).toHaveBeenCalledWith('site_log_retention_unavailable');
  await vi.advanceTimersByTimeAsync(60000);
  expect(store.archive).toHaveBeenCalledTimes(2);
  job.stop();
});
