import { createHash } from 'node:crypto';
import { UploadError, type UploadObjects, type UploadPhoto, type UploadStore } from '../ports/upload-store.js';

export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
export const UPLOAD_TTL_MS = 15 * 60_000;
export function uploadPhotos(input: unknown): readonly UploadPhoto[] {
  if (!input || typeof input !== 'object' || Object.keys(input).join() !== 'photos') throw new UploadError('INVALID');
  const photos = (input as { photos: unknown }).photos;
  if (!Array.isArray(photos) || photos.length < 1 || photos.length > 10) throw new UploadError('INVALID');
  const result = photos.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object') throw new UploadError('INVALID');
    const p = raw as Record<string, unknown>;
    if (
      Object.keys(p).sort().join() !== 'bytes,contentType,sha256' ||
      typeof p.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(p.sha256) ||
      !Number.isSafeInteger(p.bytes) ||
      Number(p.bytes) < 1 ||
      Number(p.bytes) > MAX_PHOTO_BYTES ||
      !['image/jpeg', 'image/heic', 'image/webp'].includes(String(p.contentType))
    )
      throw new UploadError('INVALID');
    return Object.freeze({ ...p }) as UploadPhoto;
  });
  if (new Set(result.map((p) => p.sha256)).size !== result.length) throw new UploadError('INVALID');
  return Object.freeze(result);
}
function photoHeader(body: Buffer, contentType: UploadPhoto['contentType']): boolean {
  switch (contentType) {
    case 'image/jpeg':
      return body.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
    case 'image/webp':
      return body.toString('ascii', 0, 4) === 'RIFF' && body.toString('ascii', 8, 12) === 'WEBP';
    case 'image/heic':
      return (
        body.toString('ascii', 4, 8) === 'ftyp' &&
        ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(body.toString('ascii', 8, 12))
      );
  }
}
const checkedTime = (now: number) => {
  if (!Number.isSafeInteger(now) || now < 0) throw new UploadError('INVALID');
  return now;
};
// Byte integrity and a format header are intake checks only. GPS, freshness, novelty and the model's findings
// still need trusted processing; this function produces no assessment, decision or payment command.
export async function completeUpload(
  store: Pick<UploadStore, 'get' | 'complete'>,
  objects: Pick<UploadObjects, 'get'>,
  platformId: string,
  trancheId: string,
  id: string,
  clock: () => number,
) {
  const start = checkedTime(clock());
  const session = await store.get(platformId, trancheId, id);
  if (!session) throw new UploadError('NOT_FOUND');
  if (session.status === 'COMPLETE') return session;
  if (start >= session.expiresAt) throw new UploadError('EXPIRED');
  for (const photo of session.photos) {
    const body = await objects.get(photo.key, photo.bytes);
    if (!body) throw new UploadError('INCOMPLETE');
    if (
      body.length !== photo.bytes ||
      createHash('sha256').update(body).digest('hex') !== photo.sha256 ||
      !photoHeader(body, photo.contentType)
    )
      throw new UploadError('MISMATCH');
  }
  const completedAt = checkedTime(clock());
  if (completedAt >= session.expiresAt) throw new UploadError('EXPIRED');
  return store.complete(platformId, trancheId, id, completedAt);
}
