import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import type { UploadSession } from '../ports/upload-store.js';
import { completeUpload, uploadPhotos } from './upload-session.js';

const body = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const photo = {
  sha256: createHash('sha256').update(body).digest('hex'),
  bytes: body.length,
  contentType: 'image/jpeg' as const,
};
const session: UploadSession = {
  id: 'session',
  trancheId: 'tranche',
  status: 'OPEN',
  photos: [{ ...photo, key: 'uploads/session/photo' }],
  expiresAt: 2000,
  completedAt: null,
};
it('refuses unbounded or ambiguous photo declarations before reserving any storage', () => {
  expect(uploadPhotos({ photos: [photo] })).toEqual([photo]);
  for (const input of [
    null,
    [],
    {},
    { photos: [] },
    { photos: Array(11).fill(photo) },
    { photos: [photo, photo] },
    { photos: [{ ...photo, bytes: 8 * 1024 * 1024 + 1 }] },
    { photos: [{ ...photo, bytes: 0 }] },
    { photos: [{ ...photo, bytes: 1.5 }] },
    { photos: [{ ...photo, contentType: 'text/html' }] },
    { photos: [{ ...photo, sha256: '../elsewhere' }] },
    { photos: [{ ...photo, url: 'https://elsewhere.test' }] },
    { photos: [photo], outcome: 'PASS' },
  ])
    expect(() => uploadPhotos(input)).toThrow('INVALID');
});
it('completes only after reading every owned object and checking its bytes and hash', async () => {
  const store = {
    get: vi.fn(async () => session),
    complete: vi.fn(async () => ({ ...session, status: 'COMPLETE' as const, completedAt: 1000 })),
  };
  const objects = { get: vi.fn(async () => body) };
  expect((await completeUpload(store, objects, 'platform', 'tranche', 'session', () => 1000)).status).toBe('COMPLETE');
  expect(objects.get).toHaveBeenCalledWith('uploads/session/photo', body.length);
  expect(store.complete).toHaveBeenCalledWith('platform', 'tranche', 'session', 1000);
});
it('never completes a missing, expired, oversized, wrong-hash or wrong-format upload', async () => {
  for (const [row, bytes, now, code] of [
    [null, body, 1000, 'NOT_FOUND'],
    [session, body, 2000, 'EXPIRED'],
    [session, null, 1000, 'INCOMPLETE'],
    [session, Buffer.alloc(10), 1000, 'MISMATCH'],
    [session, Buffer.alloc(body.length), 1000, 'MISMATCH'],
    [
      { ...session, photos: [{ ...session.photos[0]!, sha256: createHash('sha256').update('html').digest('hex') }] },
      Buffer.from('html'),
      1000,
      'MISMATCH',
    ],
    [session, body, Number.NaN, 'INVALID'],
  ] as const) {
    const store = { get: vi.fn(async () => row), complete: vi.fn() };
    await expect(
      completeUpload(store, { get: async () => bytes }, 'platform', 'tranche', 'session', () => now),
    ).rejects.toThrow(code);
    expect(store.complete).not.toHaveBeenCalled();
  }
});
it('returns an immutable completed receipt without re-reading objects after expiry', async () => {
  const completed = { ...session, status: 'COMPLETE' as const, completedAt: 1000 };
  const objects = { get: vi.fn() },
    store = { get: async () => completed, complete: vi.fn() };
  expect(await completeUpload(store, objects, 'platform', 'tranche', 'session', () => 3000)).toEqual(completed);
  expect(objects.get).not.toHaveBeenCalled();
  expect(store.complete).not.toHaveBeenCalled();
});
