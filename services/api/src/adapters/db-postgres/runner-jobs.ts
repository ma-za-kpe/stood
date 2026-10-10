import { and, asc, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { RunnerJob } from '../../application/code-run.js';
import { codeTerms } from '../../application/code-terms.js';
import { restoreTrancheRecord } from '../../domain/tranche-record.js';
import * as schema from './schema.js';

const {
  commitPackages: packages,
  apiTrancheOwners: owners,
  apiAllowances: allowances,
  paymentStreams: streams,
  usageReceipts: usage,
} = schema;

// T-0159: the runner's queue. For each code tranche that is held (or deciding, or waiting after an earlier package), the latest
// package not yet decided, with the terms the buyer signed on the allowance and the commits submitted before it,
// and a final milestone again once its use is confirmed.
// A tranche whose stored terms no longer check is skipped rather than run against guessed terms.
export class PostgresRunnerJobs {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}
  async pending(limit = 10): Promise<RunnerJob[]> {
    const rows = await this.db
      .select({
        packageId: packages.id,
        platformId: packages.platformId,
        trancheId: packages.trancheId,
        metadata: packages.metadata,
        allowanceId: owners.allowanceId,
        body: allowances.body,
        record: streams.record,
      })
      .from(packages)
      .innerJoin(owners, eq(owners.trancheId, packages.trancheId))
      .innerJoin(allowances, and(eq(allowances.id, owners.allowanceId), eq(allowances.platformId, owners.platformId)))
      .innerJoin(streams, eq(streams.trancheId, packages.trancheId))
      .orderBy(asc(packages.createdAt), asc(packages.id));
    const byTranche = new Map<string, typeof rows>();
    for (const row of rows) byTranche.set(row.trancheId, [...(byTranche.get(row.trancheId) ?? []), row]);
    const jobs: RunnerJob[] = [];
    for (const [trancheId, list] of byTranche) {
      const latest = list.at(-1) as (typeof rows)[number];
      if (!latest.record) continue;
      const tranche = restoreTrancheRecord(latest.record);
      // DECIDING: a run stopped between starting and recording its decision, so it is run again.
      if (!['HELD', 'DECIDING', 'WAITING'].includes(tranche.state)) continue;
      // C4 (#77): a final milestone that waited only for usage runs again once a verified receipt for its commit exists.
      const run = tranche.decisions.find((d) => d.id === `run:${latest.packageId}`);
      let confirmed = false;
      if (run) {
        if (
          tranche.state !== 'WAITING' ||
          run.decision.outcome !== 'WAIT' ||
          !run.decision.reason.includes('usage_release') ||
          tranche.decisions.some((d) => d.id === `usage:${latest.packageId}`)
        )
          continue;
        const [receipt] = await this.db
          .select({ nonce: usage.nonce })
          .from(usage)
          .where(and(eq(usage.trancheId, trancheId), eq(usage.commit, latest.metadata.commit_sha)))
          .limit(1);
        if (!receipt) continue;
        confirmed = true;
      }
      const index = latest.body.tranches.findIndex((t) => t.id === trancheId);
      const milestone = latest.body.milestones[index];
      if (!milestone || !milestone.profile.startsWith('code.')) continue;
      let terms: RunnerJob['terms'];
      try {
        terms = codeTerms(milestone.params);
      } catch {
        continue;
      }
      jobs.push({
        platformId: latest.platformId,
        allowanceId: latest.allowanceId,
        trancheId,
        packageId: latest.packageId,
        profileId: milestone.profile,
        amount: { minor: milestone.amount.minor, currency: milestone.amount.currency },
        terms: { ...terms, testIds: [...terms.testIds], tests: terms.tests.map((t) => ({ ...t })) },
        package: {
          repository: latest.metadata.repository,
          baseCommit: latest.metadata.base_commit,
          commit: latest.metadata.commit_sha,
        },
        priorCommits: list.slice(0, -1).map((r) => r.metadata.commit_sha),
        ...(confirmed ? { usageConfirmed: true } : {}),
      });
      if (jobs.length >= limit) break;
    }
    return jobs;
  }
}
