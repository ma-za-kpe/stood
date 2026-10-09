import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import type { TribunalCatalog } from '../adapters/tribunal-catalog.js';
import { type BoardConfig, boardHttp } from './board-http.js';
import { hostedSessions } from './browser-session.js';
import { type EventFeed, eventFeed } from './event-feed.js';
export function createYardApp(
  config: Readonly<{
    environment: string;
    research?: Pick<TribunalCatalog, 'list'>;
    eventFeed?: EventFeed;
    board?: BoardConfig;
    // T-0266: hosted sign-in for the Yard page, served from this origin.
    browser?: Readonly<{ origin: string }>;
    // T-0267: the built Yard page, served from this origin.
    web?: Readonly<{ root: string }>;
  }>,
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
        payments: !!config.board?.mandates,
      },
    }),
  );
  const research = config.research;
  if (research)
    app.get('/app/api/research/ideas', async (c) => {
      try {
        c.header('Cache-Control', 'public, max-age=600');
        return c.json(await research.list());
      } catch {
        c.header('Cache-Control', 'no-store');
        return c.json({ code: 'research_unavailable' }, 503);
      }
    });
  if (config.eventFeed) eventFeed(app, config.eventFeed);
  if (config.board) boardHttp(app, config.board);
  if (config.board && config.browser)
    hostedSessions(app, {
      operators: config.board.operators,
      clock: config.board.clock,
      origin: config.browser.origin,
    });
  if (config.web) {
    app.get('/app', (c) => c.redirect(`/app/${new URL(c.req.url).search}`, 308));
    app.get('/', (c) => c.redirect('/app/', 302));
    app.use(
      '/app/*',
      secureHeaders({
        contentSecurityPolicy: {
          defaultSrc: ["'self'"],
          connectSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
        },
        xFrameOptions: 'DENY',
      }),
    );
    app.use('/app/*', serveStatic({ root: config.web.root, rewriteRequestPath: (p) => p.replace(/^\/app/, '') }));
  }
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
