import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { repeat } from './repeat.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('never overlaps: a slow pass delays the next one instead of running beside it', async () => {
  let active = 0,
    most = 0,
    passes = 0;
  let finish = () => {};
  const job = repeat(
    () => {
      passes++;
      active++;
      most = Math.max(most, active);
      return new Promise<void>((resolve) => {
        finish = () => {
          active--;
          resolve();
        };
      });
    },
    1000,
    () => {},
  );
  const first = job.run();
  expect(job.run()).toBe(first);
  await vi.advanceTimersByTimeAsync(5000);
  expect(passes).toBe(1);
  finish();
  await first;
  await vi.advanceTimersByTimeAsync(999);
  expect(passes).toBe(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(passes).toBe(2);
  expect(most).toBe(1);
  finish();
  await job.stop();
});

it('reports a failed pass and keeps going', async () => {
  const errors: unknown[] = [];
  let calls = 0;
  const job = repeat(
    async () => {
      calls++;
      if (calls === 1) throw new Error('provider down');
    },
    1000,
    (e) => errors.push(e),
  );
  await job.run();
  expect(errors).toEqual([new Error('provider down')]);
  await vi.advanceTimersByTimeAsync(1000);
  expect(calls).toBe(2);
  await job.stop();
});

it('stop waits for the running pass and schedules nothing after it', async () => {
  let done = false,
    calls = 0;
  let finish = () => {};
  const job = repeat(
    () => {
      calls++;
      return new Promise<void>((resolve) => {
        finish = () => {
          done = true;
          resolve();
        };
      });
    },
    1000,
    () => {},
  );
  void job.run();
  const stopping = job.stop();
  let stopped = false;
  void stopping.then(() => {
    stopped = true;
  });
  await vi.advanceTimersByTimeAsync(10);
  expect(stopped).toBe(false);
  finish();
  await stopping;
  expect(done).toBe(true);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(calls).toBe(1);
  await job.run();
  expect(calls).toBe(1);
});

it('refuses a nonsensical interval', () => {
  expect(() =>
    repeat(
      async () => {},
      0,
      () => {},
    ),
  ).toThrow('Invalid job interval');
});
