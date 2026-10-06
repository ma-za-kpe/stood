import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { staticServer } from './serve.mjs';

test('directory URLs redirect before serving relative assets, preserving query and preview prefix', async () => {
  const root = mkdtempSync(join(tmpdir(), 'stood-static-'));
  mkdirSync(join(root, 'yard', 'app'), { recursive: true });
  writeFileSync(join(root, 'yard', 'app', 'index.html'), 'app');
  const server = staticServer(root);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const method of ['GET', 'HEAD']) {
      const response = await fetch(`${origin}/yard/app?project=demo`, { method, redirect: 'manual' });
      assert.equal(response.status, 308);
      assert.equal(response.headers.get('location'), '/yard/app/?project=demo');
    }
    assert.equal(await (await fetch(`${origin}/yard/app/`)).text(), 'app');
    assert.equal((await fetch(`${origin}/missing`, { redirect: 'manual' })).status, 404);
    assert.equal((await fetch(`${origin}/yard/app`, { method: 'POST', redirect: 'manual' })).status, 405);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(root, { recursive: true, force: true });
  }
});

test('directory redirects retain a configured hosting prefix', async () => {
  const root = mkdtempSync(join(tmpdir(), 'stood-static-prefix-'));
  mkdirSync(join(root, 'yard', 'app'), { recursive: true });
  writeFileSync(join(root, 'yard', 'app', 'index.html'), 'app');
  const server = staticServer(root, '/__pages');
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/yard/app?intake=demo`, {
      redirect: 'manual',
    });
    assert.equal(response.status, 308);
    assert.equal(response.headers.get('location'), '/__pages/yard/app/?intake=demo');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(root, { recursive: true, force: true });
  }
});
