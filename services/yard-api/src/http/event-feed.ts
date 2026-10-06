import type { Context, Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { YardEvents } from '../ports/events.js';
import { EventWake } from './event-wake.js';
export type EventFeed = Readonly<{
  store: Pick<YardEvents, 'read' | 'subscribe'> & {
    load(id: string): Promise<{ version: number; retainedFrom?: number }>;
  };
  route?:
    | '/yard/v1/blueprints/:id/events'
    | '/yard/v1/intakes/:id/events'
    | '/yard/v1/blueprints/:id/work-orders/:wo/log/events';
  resource?(c: Context): string;
  authorize(headers: Headers, projectId: string, target: string): Promise<boolean>;
}>;
export function eventFeed(app: Hono, feed: EventFeed): void {
  const wake = new EventWake(feed.store);
  app.get(feed.route ?? '/yard/v1/blueprints/:id/events', async (c) => {
    const id = feed.resource?.(c) ?? c.req.param('id');
    const url = new URL(c.req.url);
    const headers = new Headers(c.req.raw.headers),
      target = `${url.pathname}${url.search}`;
    if (!(await feed.authorize(headers, id, target))) return c.json({ code: 'unauthorized' }, 401);
    const raw = c.req.header('Last-Event-ID') ?? c.req.query('since') ?? '0';
    if (!/^\d{1,10}$/.test(raw)) return c.json({ code: 'invalid_cursor' }, 400);
    let cursor = Number(raw);
    const snapshot = await feed.store.load(id);
    if (cursor > snapshot.version || cursor < (snapshot.retainedFrom ?? 1) - 1)
      return c.json({ code: 'snapshot_required' }, 409);
    c.header('Cache-Control', 'no-store');
    return streamSSE(c, async (stream) => {
      const subscription = await wake.attach(id);
      let stopped = false;
      stream.onAbort(() => {
        stopped = true;
        subscription.close();
      });
      const access = async () => {
        let allowed = false;
        try {
          allowed = await feed.authorize(headers, id, target);
        } catch {
          allowed = false;
        }
        if (!allowed) await stream.writeSSE({ event: 'authorization.required', data: '{}' });
        return allowed;
      };
      try {
        while (!stopped && !stream.aborted) {
          if (!(await access())) break;
          const generation = subscription.generation();
          if (snapshot.retainedFrom !== undefined) {
            const bounds = await feed.store.load(id);
            if (!(await access())) break;
            if (bounds.retainedFrom !== snapshot.retainedFrom) {
              await stream.writeSSE({ event: 'snapshot.required', data: '{}' });
              break;
            }
          }
          const events = await feed.store.read(id, cursor);
          if (!(await access())) break;
          if (events.length > 500 || (events[0] && events[0].seq !== cursor + 1)) {
            await stream.writeSSE({ event: 'snapshot.required', data: JSON.stringify({ code: 'snapshot_required' }) });
            break;
          }
          for (const event of events) {
            if (!(await access())) {
              stopped = true;
              break;
            }
            if (event.seq !== cursor + 1) {
              stopped = true;
              await stream.writeSSE({ event: 'snapshot.required', data: '{}' });
              break;
            }
            await stream.writeSSE({ id: String(event.seq), event: event.type, data: JSON.stringify(event) });
            cursor = event.seq;
          }
          if (stopped || stream.aborted) break;
          await stream.write(': hb\n\n');
          await stream.writeSSE({ event: 'heartbeat', data: JSON.stringify({ seq: cursor }) });
          if (!stopped && !stream.aborted) await subscription.wait(generation);
        }
      } finally {
        subscription.close();
      }
    });
  });
}
