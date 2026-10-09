import { createHmac, randomBytes } from 'node:crypto';
import { expect, it } from 'vitest';
import { claimedFixture, leaseAt, leaseBuilder, leaseBuyer } from '../../test/fakes/board-fixture.js';
import { renderApiFake } from '../../test/fakes/render-api.js';
import { MemorySecretRows } from '../../test/fakes/secrets.js';
import { LocalKeyWrapper } from '../adapters/crypto/local-key-wrapper.js';
import { RenderPreviewHost } from '../adapters/render/render-host.js';
import { Previews } from '../application/previews.js';
import { SecretVault } from '../application/secret-vault.js';
import { createYardApp } from './app.js';

const image = `ghcr.io/buyer/project@sha256:${'d'.repeat(64)}`;
// T-0196: only the buyer asks for a preview: it receives the buyer's TEST keys, so a builder choosing the image
// could exfiltrate them. A retry returns the live preview instead of starting a second service.
it('lets only the buyer start one preview of a submitted milestone, from a digest-pinned image', async () => {
  const { board, id } = await claimedFixture();
  const vault = new SecretVault(
    new MemorySecretRows(),
    new LocalKeyWrapper({ k1: randomBytes(32).toString('base64') }, 'k1'),
  );
  const render = renderApiFake({ apiKey: 'rnd_fixture', maxServices: 10 });
  const host = new RenderPreviewHost({ apiKey: 'rnd_fixture', ownerId: 'tea-yard', transport: render.fetch });
  const app = createYardApp({
    environment: 'ci',
    board: {
      board,
      clock: async () => leaseAt,
      previews: new Previews(board, vault, host),
      operators: [
        { key: 'buyer-key', secret: 'buyer-secret', actor: leaseBuyer },
        { key: 'builder-key', secret: 'builder-secret', actor: leaseBuilder },
      ],
    },
  });
  const ask = (wo: string, value: unknown, who = 'buyer', key = 'p1') => {
    const path = `/yard/v1/blueprints/${id}/work-orders/${wo}/preview`,
      raw = JSON.stringify(value),
      t = String(leaseAt / 1000);
    const mac = createHmac('sha256', `${who}-secret`)
      .update(JSON.stringify(['yard.request@2', t, `${who}-key`, 'POST', path, key, '1', 'application/json', '', raw]))
      .digest('hex');
    return app.request(path, {
      method: 'POST',
      body: raw,
      headers: {
        'Yard-Key-Id': `${who}-key`,
        'Yard-Signature': `t=${t},v2=${mac}`,
        'Idempotency-Key': key,
        'Content-Type': 'application/json',
        'If-Match': '1',
      },
    });
  };
  expect((await ask('one', { image })).status).toBe(409);
  const v = (await board.events.load(id)).version;
  await board.submit(id, 'one', 'd'.repeat(40), 'pkg-1', leaseBuilder, v, 'submit', leaseAt);
  expect((await ask('one', { image }, 'builder')).status).toBe(403);
  expect((await ask('one', { image: 'ghcr.io/buyer/project:latest' })).status).toBe(422);
  expect((await ask('one', { image, extra: true })).status).toBe(422);
  const first = await ask('one', { image });
  expect(first.status).toBe(200);
  const preview = (await first.json()) as { url: string; expiresAt: number };
  expect(preview).toMatchObject({ url: expect.stringMatching(/^https:\/\//), expiresAt: leaseAt + 30 * 86400000 });
  expect(await (await ask('one', { image }, 'buyer', 'p2')).json()).toEqual(preview);
  expect(render.services()).toHaveLength(1);
  expect(render.services()[0]?.envVars.map((e) => e.key)).toEqual(['YARD_PREVIEW']);
});
