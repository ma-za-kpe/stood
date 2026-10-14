import { describe, expect, it, vi } from 'vitest';
import { cleanupExpiredUploads, UPLOAD_CLEANUP_GRACE_MS } from './upload-cleanup.js';

const photo = (index: number) => ({
  sha256: String(index).repeat(64),
  bytes: 4,
  contentType: 'image/jpeg' as const,
  key: `uploads/upl_12345678-1234-1234-1234-123456789abc/${index}-${String(index).repeat(64)}`,
});

describe('cleanupExpiredUploads', () => {
  it('waits past expiry, records per-object outcomes, isolates failures and is safe to retry', async () => {
    const now = 2_000_000;
    const photos = [photo(1), photo(2), photo(3)];
    const store = {
      expiredOpen: vi.fn(async (_at: number, grace: number) => {
        expect(grace).toBe(UPLOAD_CLEANUP_GRACE_MS);
        return [{ id: 'upl_12345678-1234-1234-1234-123456789abc', photos }];
      }),
      recordCleanup: vi.fn(async (_id: string, _key: string, _result: string) => true),
    };
    const objects = {
      deleteUpload: vi
        .fn()
        .mockResolvedValueOnce('DELETED' as const)
        .mockRejectedValueOnce(new Error('temporary bucket failure'))
        .mockResolvedValueOnce('ABSENT' as const),
    };

    expect(await cleanupExpiredUploads(store, objects, now)).toEqual({ sessions: 1, deleted: 1, absent: 1, failed: 1 });
    expect(store.recordCleanup).toHaveBeenCalledTimes(2);
    expect(store.recordCleanup).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      photos[0]!.key,
      'DELETED',
      now,
      UPLOAD_CLEANUP_GRACE_MS,
    );
    expect(store.recordCleanup).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      photos[2]!.key,
      'ABSENT',
      now,
      UPLOAD_CLEANUP_GRACE_MS,
    );
  });

  it('rejects invalid cleanup clocks before listing or deleting anything', async () => {
    const store = { expiredOpen: vi.fn(), recordCleanup: vi.fn() };
    const objects = { deleteUpload: vi.fn() };
    await expect(cleanupExpiredUploads(store, objects, Number.NaN)).rejects.toThrow('Invalid cleanup clock');
    expect(store.expiredOpen).not.toHaveBeenCalled();
    expect(objects.deleteUpload).not.toHaveBeenCalled();
  });
});
