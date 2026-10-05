import { createServer, request } from 'node:http';
import { staticServer } from './serve.mjs';

if (process.env.NETWORK_MOCK !== 'true' || process.env.APP_ENV !== 'ci') throw new Error('Mock web refused');
const files = staticServer('_site');
createServer({ maxHeaderSize: 8192 }, (req, res) => {
  if (!req.url?.startsWith('/app/api/')) {
    files.emit('request', req, res);
    return;
  }
  if (req.headers.origin) {
    try {
      const origin = new URL(req.headers.origin);
      if (origin.protocol !== 'http:' || origin.host !== req.headers.host) throw new Error('origin');
    } catch {
      res.writeHead(403).end('Origin refused');
      return;
    }
  }
  const headers = {};
  for (const name of ['content-type', 'cookie', 'accept', 'last-event-id', 'if-match', 'idempotency-key'])
    if (req.headers[name]) headers[name] = req.headers[name];
  const upstream = request(
    { hostname: 'yard-api', port: 3001, path: req.url, method: req.method, headers },
    (response) => {
      res.writeHead(response.statusCode ?? 503, response.headers);
      response.pipe(res);
    },
  );
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(503);
    res.end('Mock Yard unavailable');
  });
  res.on('close', () => upstream.destroy());
  req.pipe(upstream);
}).listen(3002, '0.0.0.0');
