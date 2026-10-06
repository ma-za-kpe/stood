import type { Context, Hono } from 'hono';
import type { Operator } from '../application/board.js';
import type { SiteLog } from '../application/site-log.js';
import type { YardEvent } from '../ports/events.js';
import { YardError } from '../ports/events.js';
import { eventFeed } from './event-feed.js';
export function siteLogHttp(
  app: Hono,
  config: Readonly<{
    log: SiteLog;
    request(c: Context): Readonly<{ actor: Operator; body: string; now: number }>;
    authorize(headers: Headers, project: string, wo: string, target: string): Promise<boolean>;
  }>,
) {
  const route = '/yard/v1/blueprints/:id/work-orders/:wo/log';
  app.post(route, async (c) => {
    const { actor, body, now } = config.request(c),
      key = c.req.header('Idempotency-Key') ?? '';
    if (!/^[A-Za-z0-9:._-]{1,120}$/.test(key)) throw new YardError('INVALID');
    return c.json(
      await config.log.append(c.req.param('id'), c.req.param('wo'), actor, key, JSON.parse(body), now),
      201,
    );
  });
  app.get(route, async (c) => {
    const { actor, now } = config.request(c);
    c.header('Cache-Control', 'private, no-store');
    return c.json(await config.log.snapshot(c.req.param('id'), c.req.param('wo'), actor, now));
  });
  eventFeed(app, {
    route: '/yard/v1/blueprints/:id/work-orders/:wo/log/events',
    resource: (c) => `${c.req.param('id')}:${c.req.param('wo')}`,
    authorize: (headers, id, target) => {
      const [project, wo] = id.split(':');
      return project && wo ? config.authorize(headers, project, wo, target) : Promise.resolve(false);
    },
    store: {
      load: (id) => {
        const [project, wo] = id.split(':');
        return config.log.store.bounds(project!, wo!);
      },
      read: async (id, after): Promise<readonly YardEvent[]> => {
        const [project, wo] = id.split(':');
        return (await config.log.store.read(project!, wo!, after)).map((entry) => ({
          seq: entry.seq,
          actor: entry.actor,
          at: entry.at,
          type: 'site_log.line',
          payload: entry.line,
        }));
      },
      subscribe: (id, wake) => {
        const [project, wo] = id.split(':');
        return config.log.store.subscribe(project!, wo!, wake);
      },
    },
  });
}
