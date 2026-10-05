import { serve } from '@hono/node-server';
import { createYardApp } from './http/app.js';

const app = createYardApp({ environment: process.env.YARD_ENV ?? 'local' });
const port = Number(process.env.YARD_PORT ?? '3001');
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new RangeError('Invalid YARD_PORT');
const server = serve({ fetch: app.fetch, port, hostname: '0.0.0.0' });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.close());
