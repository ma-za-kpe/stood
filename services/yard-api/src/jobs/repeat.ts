// Fifth audit (2026-10-11): a periodic job never overlaps itself. The next pass is scheduled only after the previous
// one finished, a call while a pass runs joins that pass, and stop() waits for it before the pool closes.
export type Repeating = Readonly<{ run(): Promise<void>; stop(): Promise<void> }>;

export function repeat(task: () => Promise<void>, everyMs: number, onError: (error: unknown) => void): Repeating {
  if (!Number.isSafeInteger(everyMs) || everyMs < 1) throw new RangeError('Invalid job interval');
  let running: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const run = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (running) return running;
    if (timer) clearTimeout(timer);
    timer = null;
    running = (async () => {
      try {
        await task();
      } catch (error) {
        onError(error);
      } finally {
        running = null;
        if (!stopped) {
          timer = setTimeout(() => void run(), everyMs);
          timer.unref();
        }
      }
    })();
    return running;
  };
  return {
    run,
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      await running;
    },
  };
}
