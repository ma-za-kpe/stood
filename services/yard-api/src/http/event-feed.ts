import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { YardEvents } from '../ports/events.js';
import { EventWake } from './event-wake.js';
export type EventFeed = Readonly<{
  store: YardEvents;
  authorize(headers: Headers, projectId: string, target: string): Promise<boolean>;
}>;
export function eventFeed(app: Hono, feed: EventFeed): void {
  const wake = new EventWake(feed.store);
  app.get('/yard/v1/blueprints/:id/events', async (c) => {
    const id = c.req.param('id');
    const url = new URL(c.req.url);
    if (!(await feed.authorize(c.req.raw.headers, id, `${url.pathname}${url.search}`)))
      return c.json({ code: 'unauthorized' }, 401);
    const raw = c.req.header('Last-Event-ID') ?? c.req.query('since') ?? '0';
    if (!/^\d{1,10}$/.test(raw)) return c.json({ code: 'invalid_cursor' }, 400);
    let cursor = Number(raw);
    const snapshot = await feed.store.load(id);
    if (cursor > snapshot.version) return c.json({ code: 'snapshot_required' }, 409);
    c.header('Cache-Control', 'no-store');
    return streamSSE(c, async (stream) => {
      const subscription = await wake.attach(id);
      let stopped = false;
      stream.onAbort(() => {
        stopped = true;
        subscription.close();
      });
      try {
        while (!stopped && !stream.aborted) {
          const generation = subscription.generation();
          const events = await feed.store.read(id, cursor);
          if (events.length > 500 || (events[0] && events[0].seq !== cursor + 1)) {
            await stream.writeSSE({ event: 'snapshot.required', data: JSON.stringify({ code: 'snapshot_required' }) });
            break;
          }
          for (const event of events) {
            if (event.seq !== cursor + 1) {
              stopped = true;
              await stream.writeSSE({ event: 'snapshot.required', data: '{}' });
              break;
            }
            await stream.writeSSE({ id: String(event.seq), event: event.type, data: JSON.stringify(event) });
            cursor = event.seq;
          }
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
