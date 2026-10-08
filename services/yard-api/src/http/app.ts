import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { type BoardConfig, boardHttp } from './board-http.js';
import { type EventFeed, eventFeed } from './event-feed.js';
export function createYardApp(
  config: Readonly<{ environment: string; eventFeed?: EventFeed; board?: BoardConfig }>,
): Hono {
  if (!['local', 'ci', 'demo'].includes(config.environment))
    throw new RangeError('Yard is not configured for hosted operation');
  const app = new Hono();
  // T-0262: only the project site may read health across origins (GET, no credentials).
  app.use('/health', cors({ origin: (o) => (o === 'https://ma-za-kpe.github.io' ? o : null), allowMethods: ['GET'] }));
  app.get('/health', (c) =>
    c.json({
      status: 'ok',
      product: 'yard',
      environment: config.environment,
      capabilities: {
        board: !!config.board,
        foreman: !!config.board?.foreman,
        intake: !!config.board?.intakes,
        credentials: false,
        siteLog: !!config.board?.siteLog,
        events: !!config.eventFeed || !!config.board,
        payments: false,
      },
    }),
  );
  if (config.eventFeed) eventFeed(app, config.eventFeed);
  if (config.board) boardHttp(app, config.board);
  app.all('/yard/v1/*', (c) =>
    c.json(
      {
        type: 'urn:yard:problem:not_implemented',
        status: 503,
        code: 'not_implemented',
        detail: 'This Yard workflow is not implemented yet.',
      },
      503,
    ),
  );
  return app;
}
