import type { UploadObjects, UploadStore } from '../ports/upload-store.js';

export const UPLOAD_CLEANUP_GRACE_MS = 60 * 60_000;
export const UPLOAD_CLEANUP_BATCH_SIZE = 25;

export async function cleanupExpiredUploads(
  store: Pick<UploadStore, 'expiredOpen' | 'recordCleanup'>,
  objects: Pick<UploadObjects, 'deleteUpload'>,
  now: number,
) {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('Invalid cleanup clock');
  const sessions = await store.expiredOpen(now, UPLOAD_CLEANUP_GRACE_MS, UPLOAD_CLEANUP_BATCH_SIZE);
  let deleted = 0;
  let absent = 0;
  let failed = 0;
  const pending = sessions.flatMap((session) => session.photos.map((photo) => ({ session, photo })));
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(5, pending.length) }, async () => {
      for (;;) {
        const index = next++;
        const item = pending[index];
        if (!item) return;
        try {
          const result = await objects.deleteUpload(item.photo.key);
          if (await store.recordCleanup(item.session.id, item.photo.key, result, now, UPLOAD_CLEANUP_GRACE_MS)) {
            if (result === 'DELETED') deleted += 1;
            else absent += 1;
          }
        } catch {
          // Each object is independent. A later sweep retries only objects without a durable receipt.
          failed += 1;
        }
      }
    }),
  );
  return { sessions: sessions.length, deleted, absent, failed } as const;
}
