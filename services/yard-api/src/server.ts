import { serve } from '@hono/node-server';
import { createYardApp } from './http/app.js';
import { yardRuntime } from './runtime.js';

const runtime = yardRuntime(process.env);
for (const note of runtime.notes) process.stderr.write(`${note}\n`);
await runtime.start();
const app = createYardApp(runtime.config);
const port = Number(process.env.YARD_PORT ?? process.env.PORT ?? '3001');
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new RangeError('Invalid YARD_PORT');
const server = serve({ fetch: app.fetch, port, hostname: '0.0.0.0' });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.close(() => void runtime.stop()));
