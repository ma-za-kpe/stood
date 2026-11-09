import { randomBytes, randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { UPLOAD_TTL_MS, uploadPhotos } from '../../application/upload-session.js';
import { restoreTrancheRecord } from '../../domain/tranche-record.js';
import { UploadError, type UploadPhoto, type UploadSession, type UploadStore } from '../../ports/upload-store.js';
import { readAllowanceVersion } from './allowance-versions.js';
import * as schema from './schema.js';

const {
  uploadSessions: sessions,
  uploadCleanupReceipts: cleanupReceipts,
  uploadCleanupRetries: cleanupRetries,
  uploadAssessmentReceipts: assessmentReceipts,
  apiTrancheOwners: owners,
  paymentStreams: streams,
} = schema;
type Database = NodePgDatabase<typeof schema>;
const view = (row: typeof sessions.$inferSelect): UploadSession =>
  structuredClone({
    id: row.id,
    trancheId: row.trancheId,
    allowanceId: row.allowanceId,
    termsVersion: row.termsVersion,
    assessmentNonce: row.assessmentNonce,
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
        .select({ record: streams.record, allowanceId: owners.allowanceId })
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
      const allowance = await readAllowanceVersion(tx, platformId, stream.allowanceId);
      if (!allowance) throw new UploadError('CONFLICT');
      const [row] = await tx
        .insert(sessions)
        .values({
          id,
          platformId,
          trancheId,
          allowanceId: stream.allowanceId,
          termsVersion: allowance.version,
          assessmentNonce: randomBytes(32).toString('hex'),
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
  async recordAssessment(
    platformId: string,
    trancheId: string,
    id: string,
    idempotencyKey: string,
    requestHash: string,
    receipt: import('../../ports/upload-store.js').StoredAssessmentReceipt,
    receiptHash: string,
    now: number,
  ) {
    time(now);
    if (
      !idempotencyKey.trim() ||
      idempotencyKey.length > 200 ||
      !/^[a-f0-9]{64}$/.test(requestHash) ||
      !/^[a-f0-9]{64}$/.test(receiptHash)
    )
      throw new UploadError('INVALID');
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(sessions)
        .where(identity(platformId, trancheId, id))
        .for('update');
      if (!row) throw new UploadError('NOT_FOUND');
      if (
        row.status !== 'COMPLETE' ||
        row.allowanceId === null ||
        row.termsVersion === null ||
        row.assessmentNonce === null
      )
        throw new UploadError('CONFLICT');
      const [prior] = await tx.select().from(assessmentReceipts).where(eq(assessmentReceipts.uploadId, id));
      if (prior) {
        if (
          prior.idempotencyKey !== idempotencyKey ||
          prior.requestHash !== requestHash ||
          prior.receiptHash !== receiptHash
        )
          throw new UploadError('CONFLICT');
        return structuredClone(prior.receipt);
      }
      const [saved] = await tx
        .insert(assessmentReceipts)
        .values({ uploadId: id, idempotencyKey, requestHash, receipt, receiptHash, recordedAt: now })
        .onConflictDoNothing()
        .returning();
      if (saved) return structuredClone(saved.receipt);
      const [raced] = await tx.select().from(assessmentReceipts).where(eq(assessmentReceipts.uploadId, id));
      if (
        !raced ||
        raced.idempotencyKey !== idempotencyKey ||
        raced.requestHash !== requestHash ||
        raced.receiptHash !== receiptHash
      )
        throw new UploadError('CONFLICT');
      return structuredClone(raced.receipt);
    });
  }
  async loadAssessment(platformId: string, trancheId: string, id: string, idempotencyKey: string, requestHash: string) {
    if (!idempotencyKey.trim() || idempotencyKey.length > 200 || !/^[a-f0-9]{64}$/.test(requestHash))
      throw new UploadError('INVALID');
    const [owned] = await this.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(identity(platformId, trancheId, id));
    if (!owned) throw new UploadError('NOT_FOUND');
    const [prior] = await this.db.select().from(assessmentReceipts).where(eq(assessmentReceipts.uploadId, id));
    if (!prior) return null;
    if (prior.idempotencyKey !== idempotencyKey || prior.requestHash !== requestHash) throw new UploadError('CONFLICT');
    return structuredClone(prior.receipt);
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
            AND NOT EXISTS (
              SELECT 1 FROM upload_cleanup_retries retry
              WHERE retry.session_id = ${sessions.id}
                AND retry.object_key = photo->>'key'
                AND retry.next_attempt_at > ${now}
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
    const retries = await this.db
      .select({ sessionId: cleanupRetries.sessionId, objectKey: cleanupRetries.objectKey })
      .from(cleanupRetries)
      .where(
        and(
          inArray(
            cleanupRetries.sessionId,
            rows.map((row) => row.id),
          ),
          sql`${cleanupRetries.nextAttemptAt} > ${now}`,
        ),
      );
    const done = new Map<string, Set<string>>();
    for (const receipt of receipts) {
      const keys = done.get(receipt.sessionId) ?? new Set<string>();
      keys.add(receipt.objectKey);
      done.set(receipt.sessionId, keys);
    }
    for (const retry of retries) {
      const keys = done.get(retry.sessionId) ?? new Set<string>();
      keys.add(retry.objectKey);
      done.set(retry.sessionId, keys);
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
        row?.status !== 'OPEN' ||
        row.expiresAt > now - graceMs ||
        !row.photos.some((photo) => photo.key === objectKey)
      )
        return false;
      const [receipt] = await tx
        .insert(cleanupReceipts)
        .values({ sessionId: id, objectKey, outcome, recordedAt: now })
        .onConflictDoNothing()
        .returning({ objectKey: cleanupReceipts.objectKey });
      if (receipt) {
        await tx
          .delete(cleanupRetries)
          .where(and(eq(cleanupRetries.sessionId, id), eq(cleanupRetries.objectKey, objectKey)));
      }
      return !!receipt;
    });
  }

  async recordCleanupFailure(id: string, objectKey: string, now: number, graceMs: number) {
    time(now);
    if (
      !/^upl_[a-f0-9-]{36}$/.test(id) ||
      !Number.isSafeInteger(graceMs) ||
      graceMs < 0 ||
      graceMs > now ||
      !new RegExp(`^uploads/${id}/[0-9]+-[a-f0-9]{64}$`).test(objectKey)
    )
      throw new UploadError('INVALID');
    await this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(sessions).where(eq(sessions.id, id)).for('update');
      if (
        row?.status !== 'OPEN' ||
        row.expiresAt > now - graceMs ||
        !row.photos.some((photo) => photo.key === objectKey)
      )
        return;
      const [prior] = await tx
        .select({ attempts: cleanupRetries.attempts })
        .from(cleanupRetries)
        .where(and(eq(cleanupRetries.sessionId, id), eq(cleanupRetries.objectKey, objectKey)))
        .for('update');
      const attempts = Math.min((prior?.attempts ?? 0) + 1, 13);
      const backoffMs = Math.min(24 * 60 * 60_000, 60_000 * 2 ** Math.min(attempts - 1, 12));
      await tx
        .insert(cleanupRetries)
        .values({ sessionId: id, objectKey, attempts, nextAttemptAt: now + backoffMs })
        .onConflictDoUpdate({
          target: [cleanupRetries.sessionId, cleanupRetries.objectKey],
          set: { attempts, nextAttemptAt: now + backoffMs },
        });
    });
  }
}
