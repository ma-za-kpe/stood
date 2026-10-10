import pg from 'pg';
import { releaseReview } from './application/release-review.js';

// Operator tool (owner decision 2026-10-10): lists every decision on a code milestone that the in-process runner
// recorded, for the owner to review before settlement is switched back on. It runs in a READ ONLY transaction and
// prints tranche ids, decision ids and outcomes only. The releases it lists are void for payment: settlement refuses
// to capture them (fenced: yes), and nothing here replays them.
const url = process.env.DATABASE_URL?.trim();
if (!url) {
  process.stdout.write('Release review: DATABASE_URL is not set. See docs/SETUP.md.\n');
  process.exit(2);
}
const pool = new pg.Pool({ connectionString: url, max: 1 });
const client = await pool.connect();
try {
  await client.query('BEGIN READ ONLY');
  const { rows } = await client.query<{ tranche_id: string; record: string }>(
    'SELECT tranche_id, record FROM payment_streams WHERE record IS NOT NULL ORDER BY tranche_id',
  );
  await client.query('ROLLBACK');
  const review = releaseReview(rows.map((r) => ({ trancheId: r.tranche_id, record: r.record })));
  for (const r of review)
    process.stdout.write(
      `${r.trancheId}  ${r.profileId}  ${r.state}  ${r.decisionId}  ${r.outcome} (${r.reason})  fenced: ${r.fenced ? 'yes' : 'NO'}\n`,
    );
  const releases = review.filter((r) => r.outcome === 'RELEASE');
  process.stdout.write(
    `${review.length} decision(s) from the old runner, ${releases.length} release(s); ${releases.filter((r) => !r.fenced).length} not fenced.\n`,
  );
} finally {
  client.release();
  await pool.end();
}
