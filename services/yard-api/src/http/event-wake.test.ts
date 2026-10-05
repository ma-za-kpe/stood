import { expect, it, vi } from 'vitest';
import type { YardEvents } from '../ports/events.js';
import { EventWake } from './event-wake.js';

it('shares subscriptions, wakes concurrent viewers and cleans up once', async () => {
  let notify = () => {};
  const release = vi.fn();
  const subscribe = vi.fn(async (_id, wake) => {
    notify = wake;
    return release;
  });
  const hub = new EventWake({ subscribe } as unknown as YardEvents);
  const [a, b] = await Promise.all([hub.attach('p'), hub.attach('p')]);
  expect(subscribe).toHaveBeenCalledTimes(1);
  const waited = Promise.all([a.wait(a.generation()), b.wait(b.generation())]);
  notify();
  await waited;
  expect(a.generation()).toBe(1);
  await a.wait(0); // notification arriving during a read cannot be missed
  a.close();
  expect(release).not.toHaveBeenCalled();
  b.close();
  b.close();
  expect(release).toHaveBeenCalledTimes(1);
});
it('wakes on shared fallback when notifications fail and cancels timers on disconnect', async () => {
  vi.useFakeTimers();
  try {
    const hub = new EventWake({
      subscribe: async () => {
        throw new Error('offline');
      },
    } as unknown as YardEvents);
    const a = await hub.attach('p');
    const waiting = a.wait(0);
    await vi.advanceTimersByTimeAsync(15000);
    await waiting;
    a.close();
    await a.wait(a.generation());
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
