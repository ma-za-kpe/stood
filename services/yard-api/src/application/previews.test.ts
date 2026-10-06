import { randomBytes } from 'node:crypto';
import { expect, it } from 'vitest';
import { claimedFixture, leaseAt, leaseBuilder, leaseBuyer } from '../../test/fakes/board-fixture.js';
import { renderApiFake } from '../../test/fakes/render-api.js';
import { MemorySecretRows } from '../../test/fakes/secrets.js';
import { LocalKeyWrapper } from '../adapters/crypto/local-key-wrapper.js';
import { RenderPreviewHost } from '../adapters/render/render-host.js';
import { Previews } from './previews.js';
import { SecretVault } from './secret-vault.js';

const day = 86400000;
const image = `ghcr.io/buyer/project@sha256:${'d'.repeat(64)}`;
async function harness(maxServices = 5) {
  const { board, id } = await claimedFixture();
  await board.submit(id, 'one', 'd'.repeat(40), 'pkg-1', leaseBuilder, 6, 'submit', leaseAt);
  const rows = new MemorySecretRows();
  const vault = new SecretVault(rows, new LocalKeyWrapper({ k1: randomBytes(32).toString('base64') }, 'k1'));
  await vault.put({
    blueprintId: id,
    owner: 'buyer',
    provider: 'supabase',
    name: 'SUPABASE_URL',
    environment: 'TEST',
    value: 'https://dev-project.supabase.co',
    key: 'k',
    now: leaseAt,
  });
  const render = renderApiFake({ apiKey: 'rnd_fixture', maxServices });
  const host = new RenderPreviewHost({ apiKey: 'rnd_fixture', ownerId: 'tea-yard', transport: render.fetch });
  return { board, id, rows, vault, render, previews: new Previews(board, vault, host) };
}

it('deploys a digest-pinned preview with test keys only, audited, and records its URL (T-0196, T-0226)', async () => {
  const h = await harness();
  await expect(h.previews.deploy(h.id, 'one', 'ghcr.io/buyer/project:latest', leaseAt)).rejects.toThrow('INVALID');
  const preview = await h.previews.deploy(h.id, 'one', image, leaseAt);
  expect(preview).toMatchObject({
    url: expect.stringMatching(/^https:\/\/yard-preview-.+\.onrender\.com$/),
    expiresAt: leaseAt + 30 * day,
  });
  const service = h.render.services()[0];
  expect(service).toMatchObject({ image: { imagePath: image }, ownerId: 'tea-yard' });
  expect(service?.envVars).toEqual([
    { key: 'SUPABASE_URL', value: 'https://dev-project.supabase.co' },
    { key: 'YARD_PREVIEW', value: 'simulated-test-data' },
  ]);
  expect(h.rows.audited()).toEqual([
    expect.objectContaining({ blueprintId: h.id, name: 'SUPABASE_URL', deployId: expect.stringMatching(/^preview-/) }),
  ]);
  const room = await h.board.room(h.id, leaseBuyer);
  expect(room.previews).toEqual([{ wo: 'one', url: preview.url, expiresAt: preview.expiresAt }]);
  // The event log never carries a key value.
  expect(JSON.stringify(await h.board.events.read(h.id, 0))).not.toContain('dev-project');
});

it('tears previews down after their TTL and on project close, and respects the spend cap', async () => {
  const h = await harness(1);
  await h.previews.deploy(h.id, 'one', image, leaseAt);
  // A second preview over the cap is refused by the host and nothing is recorded.
  await expect(h.previews.deploy(h.id, 'one', image, leaseAt + 1)).rejects.toThrow();
  expect((await h.board.room(h.id, leaseBuyer)).previews).toHaveLength(1);
  expect(await h.previews.sweep(leaseAt + 30 * day - 1)).toBe(0);
  expect(await h.previews.sweep(leaseAt + 30 * day)).toBe(1);
  expect(h.render.services()).toEqual([]);
  expect((await h.board.room(h.id, leaseBuyer)).previews).toEqual([]);
  expect((await h.board.events.read(h.id, 0)).map((e) => e.type)).toContain('preview.expired');
  // Close-out removes every remaining preview.
  await h.previews.deploy(h.id, 'one', image, leaseAt + 30 * day + 1);
  expect(await h.previews.closeOut(h.id, leaseAt + 30 * day + 2)).toBe(1);
  expect(h.render.services()).toEqual([]);
});

it('speaks Render-shaped HTTP with the API key and refuses an unauthenticated caller', async () => {
  const render = renderApiFake({ apiKey: 'rnd_fixture', maxServices: 5 });
  const wrong = new RenderPreviewHost({ apiKey: 'rnd_wrong', ownerId: 'tea-yard', transport: render.fetch });
  await expect(wrong.deploy({ name: 'yard-preview-x', image, env: {} })).rejects.toThrow();
  expect(() => new RenderPreviewHost({ apiKey: '', ownerId: 'tea-yard' })).toThrow();
});
