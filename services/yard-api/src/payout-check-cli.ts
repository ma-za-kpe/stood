import { createHash, randomUUID } from 'node:crypto';
import { PayPalPayouts } from './adapters/paypal/payouts.js';

// Operator tool (ADR-0027): qualify builder payouts against the real PayPal sandbox with Yard's own app, through the
// same adapter the payout worker uses. Sandbox only. It pays $1.00 (sandbox money) to the sandbox buyer's personal
// account, then:
//   1. reads the item until PayPal settles it;
//   2. resends the same batch exactly as a retry after a lost answer would: it must not pay twice;
//   3. sends the same sender_batch_id under a new PayPal-Request-Id, which PayPal rejects as a duplicate, and shows
//      that the adapter recovers the original batch from PayPal's link.
// Prints outcomes, PayPal batch ids and statuses only; never a key, token or email.
const env = process.env;
const clientId = env.YARD_PAYPAL_CLIENT_ID?.trim() ?? '';
const clientSecret = env.YARD_PAYPAL_CLIENT_SECRET?.trim() ?? '';
const payee = env.PAYPAL_SANDBOX_BUYER_EMAIL?.trim() ?? '';
if (!clientId || !clientSecret || !payee.includes('@')) {
  process.stdout.write(
    'Payout check: YARD_PAYPAL_CLIENT_ID, YARD_PAYPAL_CLIENT_SECRET and PAYPAL_SANDBOX_BUYER_EMAIL are required.\n',
  );
  process.exit(2);
}
const base = 'https://api-m.sandbox.paypal.com';
const batchId = `yard-${createHash('sha256').update(`payout-check\0${randomUUID()}`).digest('hex').slice(0, 40)}`;
const request = { batchId, payee, minor: 100, currency: 'USD', note: 'Yard payout check (sandbox, no real money)' };
const log = (line: string) => process.stdout.write(`${line}\n`);
const ok = (good: boolean, line: string) => {
  log(`${good ? 'ok ' : 'BAD'} ${line}`);
  if (!good) process.exitCode = 1;
};

const payouts = new PayPalPayouts({ clientId, clientSecret, baseUrl: base });
const first = await payouts.send(request);
ok(
  first.outcome === 'SENT',
  `send: ${first.outcome}${first.outcome === 'SENT' ? ` (payout batch ${first.payoutBatchId})` : ''}`,
);
if (first.outcome !== 'SENT') process.exit(1);

// 1. PayPal settles a sandbox payout within seconds to minutes.
let status = 'PENDING';
for (let i = 0; i < 20 && ['PENDING', 'UNKNOWN'].includes(status); i++) {
  await new Promise((r) => setTimeout(r, i === 0 ? 3000 : 6000));
  status = (await payouts.status(first.payoutBatchId)).status;
}
ok(status === 'PAID_OUT' || status === 'UNCLAIMED', `item status: ${status}`);

// 2. A retry after a lost answer: same batch id, same PayPal-Request-Id. PayPal must answer with the same batch.
const retry = await payouts.send(request);
ok(
  retry.outcome === 'SENT' && retry.payoutBatchId === first.payoutBatchId,
  `retry with the same request id: ${retry.outcome}${retry.outcome === 'SENT' ? `, same batch: ${retry.payoutBatchId === first.payoutBatchId}` : ''}`,
);

// 3. Same sender_batch_id under a new PayPal-Request-Id: PayPal's duplicate rejection, recovered from its link.
let duplicateShape = '';
const fresh = new PayPalPayouts({
  clientId,
  clientSecret,
  baseUrl: base,
  fetch: async (input, init) => {
    const headers = new Headers(init?.headers);
    if (headers.has('PayPal-Request-Id')) headers.set('PayPal-Request-Id', randomUUID());
    const response = await fetch(input, { ...init, headers });
    if (String(input).endsWith('/v1/payments/payouts') && response.status !== 201) {
      const body = (await response
        .clone()
        .json()
        .catch(() => ({}))) as Record<string, unknown>;
      const links = Array.isArray(body.links) ? body.links.map((l) => (l as { rel?: unknown }).rel).join(',') : 'none';
      const details = Array.isArray(body.details)
        ? body.details.map((d) => (d as { issue?: unknown }).issue).join(' | ')
        : '';
      duplicateShape = `HTTP ${response.status}, name ${String(body.name)}, links [${links}], details: ${details.slice(0, 160)}`;
    }
    return response;
  },
});
const duplicate = await fresh.send(request);
log(`    PayPal's duplicate answer: ${duplicateShape || '(none: PayPal accepted it as new)'}`);
ok(
  duplicate.outcome === 'SENT' && duplicate.payoutBatchId === first.payoutBatchId,
  `duplicate sender_batch_id: ${duplicate.outcome}${duplicate.outcome === 'SENT' ? `, recovered the original batch: ${duplicate.payoutBatchId === first.payoutBatchId}` : ''}`,
);
