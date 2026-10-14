import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { UPLOAD_TTL_MS, uploadPhotos } from '../../application/upload-session.js';
import { restoreTrancheRecord } from '../../domain/tranche-record.js';
import { UploadError, type UploadPhoto, type UploadSession, type UploadStore } from '../../ports/upload-store.js';
import * as schema from './schema.js';

const {
  uploadSessions: sessions,
  uploadCleanupReceipts: cleanupReceipts,
  apiTrancheOwners: owners,
  paymentStreams: streams,
} = schema;
type Database = NodePgDatabase<typeof schema>;
const view = (row: typeof sessions.$inferSelect): UploadSession =>
  structuredClone({
    id: row.id,
    trancheId: row.trancheId,
    status: row.status,
    photos: row.photos,
    expiresAt: row.expiresAt,
    completedAt: row.completedAt,
  });
const identity = (platformId: string, trancheId: string, id: string) =>
  and(eq(sessions.platformId, platformId), eq(sessions.trancheId, trancheId), eq(sessions.id, id));
function time(now: number) {
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(now + UPLOAD_TTL_MS))
    throw new UploadError('INVALID');
}
function accepting(record: Parameters<typeof restoreTrancheRecord>[0]) {
  const tranche = restoreTrancheRecord(record);
  if (
    tranche.safeRecovery ||
    tranche.profileId !== 'construction.stage@1' ||
    !['PENDING', 'WAIT_FUNDING', 'HELD', 'DECIDING', 'WAITING', 'REAUTHORIZE_PENDING'].includes(tranche.state)
  )
    throw new UploadError('CONFLICT');
}
export class PostgresUploads implements UploadStore {
  constructor(private readonly db: Database) {}
  async reserve(
    platformId: string,
    trancheId: string,
    key: string,
    fingerprint: string,
    input: readonly UploadPhoto[],
    now: number,
  ) {
    time(now);
    const photos = uploadPhotos({ photos: input });
    if (!key.trim() || key.length > 200 || !/^[a-f0-9]{64}$/.test(fingerprint)) throw new UploadError('INVALID');
    return this.db.transaction(async (tx) => {
      const [stream] = await tx
        .select({ record: streams.record })
        .from(streams)
        .innerJoin(owners, eq(owners.trancheId, streams.trancheId))
        .where(and(eq(owners.platformId, platformId), eq(owners.trancheId, trancheId)))
        .for('update', { of: streams });
      if (!stream?.record) throw new UploadError('NOT_FOUND');
      const prior = await tx
        .select()
        .from(sessions)
        .where(and(eq(sessions.platformId, platformId), eq(sessions.trancheId, trancheId)));
      const replay = prior.find((s) => s.key === key);
      if (replay) {
        const declared = replay.photos.map(({ key: _key, ...p }) => p);
        if (
          replay.fingerprint !== fingerprint ||
          JSON.stringify(declared.map((p) => [p.sha256, p.bytes, p.contentType])) !==
            JSON.stringify(photos.map((p) => [p.sha256, p.bytes, p.contentType]))
        )
          throw new UploadError('CONFLICT');
        return view(replay);
      }
      accepting(stream.record);
      if (prior.length >= 10 || prior.some((s) => s.status === 'OPEN' && now < s.expiresAt))
        throw new UploadError('CONFLICT');
      const id = `upl_${randomUUID()}`;
      const [row] = await tx
        .insert(sessions)
        .values({
          id,
          platformId,
          trancheId,
          key,
          fingerprint,
          photos: photos.map((p, i) => ({ ...p, key: `uploads/${id}/${i}-${p.sha256}` })),
          status: 'OPEN',
          createdAt: now,
          expiresAt: now + UPLOAD_TTL_MS,
        })
        .returning();
      if (!row) throw new Error('Upload insert failed');
      return view(row);
    });
  }
  async get(platformId: string, trancheId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(sessions)
      .where(identity(platformId, trancheId, id));
    return row ? view(row) : null;
  }
  async complete(platformId: string, trancheId: string, id: string, now: number) {
    time(now);
    return this.db.transaction(async (tx) => {
      const [stream] = await tx
        .select({ record: streams.record })
        .from(streams)
        .innerJoin(owners, eq(owners.trancheId, streams.trancheId))
        .where(and(eq(owners.platformId, platformId), eq(owners.trancheId, trancheId)))
        .for('update', { of: streams });
      if (!stream?.record) throw new UploadError('NOT_FOUND');
      const [row] = await tx
        .select()
        .from(sessions)
        .where(identity(platformId, trancheId, id))
        .for('update');
      if (!row) throw new UploadError('NOT_FOUND');
      if (row.status === 'COMPLETE') return view(row);
      if (now >= row.expiresAt) throw new UploadError('EXPIRED');
      if (now < row.createdAt) throw new UploadError('INVALID');
      accepting(stream.record);
      const [done] = await tx
        .update(sessions)
        .set({ status: 'COMPLETE', completedAt: now })
        .where(identity(platformId, trancheId, id))
        .returning();
      if (!done) throw new Error('Upload completion failed');
      return view(done);
    });
  }

  async expiredOpen(now: number, graceMs: number, limit: number) {
    time(now);
    if (
      !Number.isSafeInteger(graceMs) ||
      graceMs < 0 ||
      graceMs > now ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      throw new UploadError('INVALID');
    const rows = await this.db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.status, 'OPEN'),
          lte(sessions.expiresAt, now - graceMs),
          sql`EXISTS (
            SELECT 1 FROM jsonb_array_elements(${sessions.photos}) AS photo
            WHERE NOT EXISTS (
              SELECT 1 FROM upload_cleanup_receipts receipt
              WHERE receipt.session_id = ${sessions.id} AND receipt.object_key = photo->>'key'
            )
          )`,
        ),
      )
      .orderBy(asc(sessions.expiresAt), asc(sessions.id))
      .limit(limit);
    if (!rows.length) return [];
    const receipts = await this.db
      .select({ sessionId: cleanupReceipts.sessionId, objectKey: cleanupReceipts.objectKey })
      .from(cleanupReceipts)
      .where(
        inArray(
          cleanupReceipts.sessionId,
          rows.map((row) => row.id),
        ),
      );
    const done = new Map<string, Set<string>>();
    for (const receipt of receipts) {
      const keys = done.get(receipt.sessionId) ?? new Set<string>();
      keys.add(receipt.objectKey);
      done.set(receipt.sessionId, keys);
    }
    return rows
      .map((row) => ({
        id: row.id,
        photos: row.photos.filter((photo) => !done.get(row.id)?.has(photo.key)),
      }))
      .filter((row) => row.photos.length > 0);
  }

  async recordCleanup(id: string, objectKey: string, outcome: 'DELETED' | 'ABSENT', now: number, graceMs: number) {
    time(now);
    if (
      !/^upl_[a-f0-9-]{36}$/.test(id) ||
      !Number.isSafeInteger(graceMs) ||
      graceMs < 0 ||
      graceMs > now ||
      !new RegExp(`^uploads/${id}/[0-9]+-[a-f0-9]{64}$`).test(objectKey)
    )
      throw new UploadError('INVALID');
    return this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(sessions).where(eq(sessions.id, id)).for('update');
      if (
        !row ||
        row.status !== 'OPEN' ||
        row.expiresAt > now - graceMs ||
        !row.photos.some((photo) => photo.key === objectKey)
      )
        return false;
      const [receipt] = await tx
        .insert(cleanupReceipts)
        .values({ sessionId: id, objectKey, outcome, recordedAt: now })
        .onConflictDoNothing()
        .returning({ objectKey: cleanupReceipts.objectKey });
      return !!receipt;
    });
  }
}
