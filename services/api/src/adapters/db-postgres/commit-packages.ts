import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { commitPackage } from '../../application/commit-package.js';
import { restoreTrancheRecord } from '../../domain/tranche-record.js';
import {
  CommitPackageError,
  type CommitPackageInput,
  type CommitPackageStore,
  type StoredCommitPackage,
} from '../../ports/commit-package-store.js';
import * as schema from './schema.js';

const { commitPackages: packages, apiTrancheOwners: owners, paymentStreams: streams } = schema;
const result = (row: typeof packages.$inferSelect): StoredCommitPackage =>
  Object.freeze({
    id: row.id,
    trancheId: row.trancheId,
    status: 'QUEUED',
    waitingFor: row.waitingFor,
    metadata: Object.freeze({ ...row.metadata }),
    createdAt: row.createdAt,
  });
// T-0137: what a queued package waits for now, derived from the tranche's durable state on every read.
// The intake receipt stays immutable; a worker restart recomputes the same answer.
export function currentWait(state: string, holds: number): StoredCommitPackage['waitingFor'] {
  if (state === 'REAUTHORIZE_PENDING') return 'RENEWAL';
  if (holds > 0 && ['HELD', 'DECIDING', 'WAITING'].includes(state)) return 'RUNNER';
  return 'HOLD';
}
export class PostgresCommitPackages implements CommitPackageStore {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}
  async submit(
    platformId: string,
    trancheId: string,
    key: string,
    fingerprint: string,
    input: CommitPackageInput,
  ): Promise<StoredCommitPackage> {
    const metadata = commitPackage(input);
    if (!key.trim() || key.length > 200 || !/^[a-f0-9]{64}$/.test(fingerprint))
      throw new CommitPackageError('INVALID_PACKAGE');
    return this.db.transaction(async (tx) => {
      const [stream] = await tx
        .select({ record: streams.record })
        .from(streams)
        .innerJoin(owners, eq(owners.trancheId, streams.trancheId))
        .where(and(eq(owners.platformId, platformId), eq(owners.trancheId, trancheId)))
        .for('update', { of: streams });
      if (!stream?.record) throw new CommitPackageError('NOT_FOUND');
      const identity = and(
        eq(packages.platformId, platformId),
        eq(packages.trancheId, trancheId),
        eq(packages.key, key),
      );
      const [prior] = await tx
        .select({ row: packages, same: sql<boolean>`${packages.metadata} = ${JSON.stringify(metadata)}::jsonb` })
        .from(packages)
        .where(identity);
      if (prior) {
        if (!prior.same || prior.row.fingerprint !== fingerprint) throw new CommitPackageError('CONFLICT');
        return result(prior.row);
      }
      const tranche = restoreTrancheRecord(stream.record);
      if (
        tranche.safeRecovery ||
        !['code.milestone@1', 'code.final@1'].includes(tranche.profileId) ||
        !['PENDING', 'WAIT_FUNDING', 'HELD', 'DECIDING', 'WAITING', 'REAUTHORIZE_PENDING'].includes(tranche.state)
      )
        throw new CommitPackageError('INVALID_PACKAGE');
      const waitingFor =
        tranche.state === 'REAUTHORIZE_PENDING' ? 'RENEWAL' : tranche.attempts.length ? 'RUNNER' : 'HOLD';
      const [row] = await tx
        .insert(packages)
        .values({ id: `pkg_${randomUUID()}`, platformId, trancheId, key, fingerprint, metadata, waitingFor })
        .returning();
      if (!row) throw new Error('Package insert failed');
      return result(row);
    });
  }
  async get(platformId: string, trancheId: string, id: string): Promise<StoredCommitPackage | null> {
    const [row] = await this.db
      .select()
      .from(packages)
      .where(and(eq(packages.platformId, platformId), eq(packages.trancheId, trancheId), eq(packages.id, id)));
    if (!row) return null;
    const [stream] = await this.db
      .select({ record: streams.record })
      .from(streams)
      .where(eq(streams.trancheId, trancheId));
    if (!stream?.record) return result(row);
    const tranche = restoreTrancheRecord(stream.record);
    return Object.freeze({ ...result(row), waitingFor: currentWait(tranche.state, tranche.attempts.length) });
  }
}
