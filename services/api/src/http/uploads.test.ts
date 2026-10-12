import { createHash, createHmac } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { UploadError } from '../ports/upload-store.js';
import { UploadSession } from './contract.js';
import { platformApi } from './platform-api.js';

const now = 1000,
  secret = 'upload-test-secret',
  body = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const photo = { sha256: createHash('sha256').update(body).digest('hex'), bytes: 4, contentType: 'image/jpeg' as const };
const session = {
  id: 'session',
  trancheId: 'tranche',
  status: 'OPEN' as const,
  photos: [{ ...photo, key: 'uploads/session/photo' }],
  expiresAt: now + 900000,
  completedAt: null,
};
function fixture() {
  const store = {
    reserve: vi.fn(async () => session),
    get: vi.fn(async () => session),
    complete: vi.fn(async () => ({ ...session, status: 'COMPLETE' as const, completedAt: now })),
  };
  const objects = {
    get: vi.fn(async () => body),
    presignPut: vi.fn(() => ({
      url: 'https://bucket.example/uploads/session/photo',
      headers: { 'content-type': 'image/jpeg' },
    })),
  };
  const app = platformApi({
    store: {} as never,
    platformId: 'platform',
    key: 'upload-key',
    secret,
    clock: () => now,
    uploads: { store, objects },
  });
  const request = (path: string, method = 'GET', input?: unknown, over: Record<string, string> = {}) => {
    const raw = input === undefined ? '' : JSON.stringify(input),
      t = String(now / 1000),
      key = 'one';
    const signature = createHmac('sha256', secret)
      .update(JSON.stringify(['stood.request@2', t, method, `/v1${path}`, key, '', 'application/json', raw]))
      .digest('hex');
    return app.request(path, {
      method,
      headers: {
        Authorization: 'Bearer upload-key',
        'Stood-Signature': `t=${t},v2=${signature}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': key,
        ...over,
      },
      ...(raw ? { body: raw } : {}),
    });
  };
  return { store, objects, request };
}
it('reserves an owned session, issues URLs only for its fixed keys and completes from trusted bytes', async () => {
  const f = fixture(),
    path = '/tranches/tranche/uploads';
  const created = await f.request(path, 'POST', { photos: [photo] });
  expect(created.status).toBe(201);
  expect(UploadSession.parse(await created.json())).toMatchObject({
    id: 'session',
    status: 'OPEN',
    uploads: [{ key: 'uploads/session/photo' }],
  });
  expect(f.store.reserve.mock.calls[0]?.slice(0, 3)).toEqual(['platform', 'tranche', 'one']);
  expect((await f.request(`${path}/session`)).status).toBe(200);
  expect(f.store.get).toHaveBeenCalledWith('platform', 'tranche', 'session');
  const complete = await f.request(`${path}/session/complete`, 'POST', {});
  expect(complete.status).toBe(200);
  expect(UploadSession.parse(await complete.json())).toMatchObject({ status: 'COMPLETE', uploads: [] });
  expect(f.objects.get).toHaveBeenCalledWith('uploads/session/photo', 4);
});
it('refuses unsigned, oversized or invalid declarations and never fetches caller-selected URLs', async () => {
  const f = fixture(),
    path = '/tranches/tranche/uploads';
  expect((await f.request(path, 'POST', { photos: [photo] }, { Authorization: 'Bearer another-key' })).status).toBe(
    401,
  );
  expect((await f.request(path, 'POST', { photos: [photo], source_url: 'https://private.example' })).status).toBe(422);
  expect((await f.request(path, 'POST', { photos: [], padding: 'x'.repeat(65536) })).status).toBe(413);
  expect((await f.request(`${path}/session/complete`, 'POST', { outcome: 'PASS' })).status).toBe(422);
  expect(f.store.reserve).not.toHaveBeenCalled();
  expect(f.store.complete).not.toHaveBeenCalled();
  expect(f.objects.get).not.toHaveBeenCalled();
});
it('returns typed absence, expiry, incomplete and storage failures without signing unrelated objects', async () => {
  const f = fixture(),
    path = '/tranches/tranche/uploads';
  for (const [code, status] of [
    ['NOT_FOUND', 404],
    ['EXPIRED', 409],
    ['CONFLICT', 409],
    ['INVALID', 422],
  ] as const) {
    f.store.reserve.mockRejectedValueOnce(new UploadError(code));
    const r = await f.request(path, 'POST', { photos: [photo] });
    expect(r.status).toBe(status);
    expect(r.headers.get('Content-Type')).toContain('application/problem+json');
  }
  f.store.reserve.mockRejectedValueOnce(new Error('private database detail'));
  const unavailable = await f.request(path, 'POST', { photos: [photo] });
  expect(unavailable.status).toBe(503);
  expect(await unavailable.text()).not.toContain('private database detail');
  f.store.get.mockResolvedValueOnce(null as never);
  expect((await f.request(`${path}/foreign`)).status).toBe(404);
  f.objects.get.mockResolvedValueOnce(null as never);
  expect((await f.request(`${path}/session/complete`, 'POST', {})).status).toBe(422);
  expect(f.store.complete).not.toHaveBeenCalled();
  expect(f.objects.presignPut).not.toHaveBeenCalled();
});
