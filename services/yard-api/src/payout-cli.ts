import pg from 'pg';
import { PostgresYardEvents } from './adapters/db-postgres/events.js';
import { Board, type PayoutAction } from './application/board.js';

// Operator tool (third audit, 2026-10-11; ADR-0027): the owner's hand on builder payouts, so no money is stuck.
//   payout-cli.js list
//   payout-cli.js <project> <wo> pay-builder|refund-buyer "<note>"      decide an open dispute
//   payout-cli.js <project> <wo> retry <payee> "<note>"                 pay a failed or returned payout again
//   payout-cli.js <project> <wo> refund "<note>"                        owe the buyer a refund instead
//   payout-cli.js <project> <wo> refunded <reference> "<note>"          record the refund made in PayPal
//   payout-cli.js <project> <wo> settle paid <payout batch id> <reference> "<note>"   PayPal shows it paid
//   payout-cli.js <project> <wo> settle not-sent <reference> "<note>"                 PayPal shows nothing sent
// Uses YARD_DATABASE_URL. Prints ids, states and amounts only.
const [first, wo, verb, ...rest] = process.argv.slice(2);
const url = process.env.YARD_DATABASE_URL?.trim() ?? '';
const usage = () => {
  process.stderr.write('Usage: see the header of services/yard-api/src/payout-cli.ts\n');
  process.exit(2);
};
if (!url || !first) usage();
const action = ((): PayoutAction | null => {
  const note = rest.at(-1) ?? '';
  if (verb === 'pay-builder' || verb === 'refund-buyer')
    return { type: 'RESOLVE_DISPUTE', outcome: verb === 'pay-builder' ? 'PAY_BUILDER' : 'REFUND_BUYER', note };
  if (verb === 'retry' && rest.length === 2) return { type: 'RETRY_PAYOUT', payee: rest[0] as string, note };
  if (verb === 'refund') return { type: 'REFUND_BUYER', note };
  if (verb === 'refunded' && rest.length === 2) return { type: 'REFUNDED', reference: rest[0] as string, note };
  if (verb === 'settle' && rest[0] === 'paid' && rest.length === 4)
    return {
      type: 'SETTLE_REVIEW',
      outcome: 'PAID_OUT',
      payoutBatchId: rest[1] as string,
      reference: rest[2] as string,
      note,
    };
  if (verb === 'settle' && rest[0] === 'not-sent' && rest.length === 3)
    return { type: 'SETTLE_REVIEW', outcome: 'NOT_SENT', reference: rest[1] as string, note };
  return null;
})();
if (first !== 'list' && (!wo || !action)) usage();
const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  const board = new Board(new PostgresYardEvents(pool, async () => Date.now()));
  if (first === 'list') {
    const items = await board.payoutAttention();
    for (const i of items)
      process.stdout.write(
        `${i.projectId}  ${i.wo}  ${i.state}  ${i.builderMinor} ${i.currency}${i.reason ? `  (${i.reason.slice(0, 80)})` : ''}\n`,
      );
    process.stdout.write(`${items.length} work order(s) need the owner.\n`);
  } else {
    const project = first as string;
    const version = (await board.events.load(project)).version;
    const now = Date.now();
    await board.payoutAction(project, wo as string, version, `${verb}:${wo}:${now}`, now, action as PayoutAction);
    const line = (await board.payoutAttention()).find((i) => i.projectId === first && i.wo === wo);
    process.stdout.write(
      `Recorded ${verb} on ${first}/${wo}; now ${line?.state ?? 'nothing pending for the owner'}.\n`,
    );
  }
} catch (error) {
  process.stderr.write(`Payout action failed: ${error instanceof Error ? error.message : 'unknown'}.\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
