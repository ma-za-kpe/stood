import { closeSync, fstatSync, openSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function staticServer(directory, publicPrefix = '') {
  const root = resolve(directory);
  const mime = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
  };
  return createServer((req, res) => {
    try {
      if (!['GET', 'HEAD'].includes(req.method)) {
        res.writeHead(405).end();
        return;
      }
      const url = new URL(req.url, 'http://localhost');
      let file = resolve(root, `.${decodeURIComponent(url.pathname)}`);
      if (!file.startsWith(`${root}/`) && file !== root) throw new Error('Outside site');
      // Open once and use that handle to check and read, so the file cannot change between the two.
      let fd = openSync(file, 'r');
      let content;
      try {
        if (fstatSync(fd).isDirectory()) {
          if (!url.pathname.endsWith('/')) {
            res
              .writeHead(308, { Location: `${publicPrefix}${url.pathname}/${url.search}`, 'Cache-Control': 'no-store' })
              .end();
            return;
          }
          closeSync(fd);
          fd = openSync(resolve(file, 'index.html'), 'r');
          file = resolve(file, 'index.html');
        }
        content = readFileSync(fd);
      } finally {
        closeSync(fd);
      }
      res.writeHead(200, {
        'Content-Type': mime[extname(file)] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch {
      res.writeHead(404).end('Not found');
    }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  staticServer('_site').listen(8082, '0.0.0.0', () =>
    console.log('Static simulated preview: http://localhost:8082/ and /yard/'),
  );
}
