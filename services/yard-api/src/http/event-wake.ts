import type { YardEvents } from '../ports/events.js';
// One fallback timer and one subscription per project, regardless of viewer count.
// Notifications are hints; durable consecutive replay remains the authority.
export class EventWake {
  private projects = new Map<
    string,
    {
      generation: number;
      viewers: number;
      waiting: Set<() => void>;
      release: () => void;
      timer: ReturnType<typeof setInterval>;
    }
  >();
  private opening = new Map<string, Promise<void>>();
  constructor(private readonly store: Pick<YardEvents, 'subscribe'>) {}
  async attach(id: string) {
    if (!this.projects.has(id)) {
      if (!this.opening.has(id))
        this.opening.set(
          id,
          (async () => {
            const state = {
              generation: 0,
              viewers: 0,
              waiting: new Set<() => void>(),
              release: () => {},
              timer: undefined as unknown as ReturnType<typeof setInterval>,
            };
            const wake = () => {
              state.generation++;
              for (const done of state.waiting) done();
              state.waiting.clear();
            };
            state.release = (await this.store.subscribe?.(id, wake).catch(() => () => {})) ?? (() => {});
            state.timer = setInterval(wake, 15000);
            state.timer.unref();
            this.projects.set(id, state);
          })(),
        );
      try {
        await this.opening.get(id);
      } finally {
        this.opening.delete(id);
      }
    }
    const state = this.projects.get(id)!;
    state.viewers++;
    let closed = false;
    return {
      generation: () => state.generation,
      wait: (generation: number) =>
        state.generation !== generation || closed
          ? Promise.resolve()
          : new Promise<void>((done) => state.waiting.add(done)),
      close: () => {
        if (closed) return;
        closed = true;
        for (const done of state.waiting) done();
        state.waiting.clear();
        if (--state.viewers === 0) {
          clearInterval(state.timer);
          state.release();
          this.projects.delete(id);
        }
      },
    };
  }
}
