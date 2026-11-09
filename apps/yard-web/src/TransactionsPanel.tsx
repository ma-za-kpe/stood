import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from './http.js';
import type { ProjectRoom } from './project-state.js';

const money = (minor: number, currency: string) =>
  new Intl.NumberFormat('en', { style: 'currency', currency }).format(minor / 100);
const ledger = z.object({
  lines: z
    .array(
      z
        .object({
          wo: z.string(),
          state: z.string().max(40),
          builderMinor: z.number().int(),
          feeMinor: z.number().int(),
          payoutReference: z.string().max(200).nullable(),
        })
        .passthrough(),
    )
    .max(100),
});
type Line = { wo: string; state: string; builderMinor: number; feeMinor: number; payoutReference: string | null };
const PAYOUT: Record<string, string> = {
  RESERVED: 'Crew payout starting',
  SENT: 'Crew payout sent',
  PAID_OUT: 'Crew paid out',
  HELD_BACK: 'Crew payout after review',
  UNCLAIMED: 'Crew payout unclaimed',
  RETURNED: 'Crew payout returned',
  FAILED: 'Crew payout failed',
  REVIEW: 'Crew payout in review',
};
// PayPal ids are short upper-case tokens; anything else is shown, never linked.
const paypalId = (s: string | null | undefined) => (s && /^[A-Z0-9]{8,40}$/.test(s) ? s : null);
const activity = (id: string) => `https://www.sandbox.paypal.com/activity/payment/${id}`;

// Proof of payment, one row per page Stood has paid. Every reference comes from Stood's matched settlement record
// (the capture) and Yard's own payout record (the Crew's money); this panel never invents a payment.
export function TransactionsPanel({ room, simulated }: { room: ProjectRoom; simulated: boolean }) {
  const paid = room.orders.flatMap((o) => (o.state === 'PAID' && o.payment ? [{ ...o, payment: o.payment }] : []));
  const lines = useQuery<Line[]>({
    queryKey: ['ledger', room.id, room.version],
    enabled: !simulated && paid.length > 0,
    retry: false,
    refetchInterval: 5_000,
    queryFn: async ({ signal }) =>
      ledger.parse(await api(`/blueprints/${encodeURIComponent(room.id)}/ledger`, { signal })).lines as Line[],
  });
  const total = paid.reduce((sum, o) => sum + o.payment.minor, 0),
    budget = room.orders.reduce((sum, o) => sum + o.budgetMinor, 0);
  return (
    <section className="transactions" aria-label="Transactions">
      <header>
        <p className="eyebrow">Transactions</p>
        <p className="transactions-total">
          {money(total, room.currency)} <span>paid of {money(budget, room.currency)}</span>
        </p>
      </header>
      {paid.length === 0 ? (
        <p className="fine">Nothing paid yet. A row appears the moment Stood captures a page.</p>
      ) : (
        <ol>
          {paid.map((o) => {
            const capture = o.payment.reference,
              line = lines.data?.find((l) => l.wo === o.id),
              payout = paypalId(line?.payoutReference);
            return (
              <li key={o.id}>
                <span className="tx-name">{o.name}</span>
                <span className="tx-amount">{money(o.payment.minor, room.currency)}</span>
                <span className="tx-kind">Stood capture · {simulated ? 'sandbox simulator' : 'PayPal sandbox'}</span>
                <code className="tx-ref" title={capture}>
                  {capture}
                </code>
                {line && (
                  <>
                    <span className="tx-kind">
                      {PAYOUT[line.state] ?? line.state} · {money(line.builderMinor, room.currency)}
                    </span>
                    <code className="tx-ref" title={line.payoutReference ?? ''}>
                      {line.payoutReference ?? '—'}
                    </code>
                  </>
                )}
                {!simulated && (paypalId(capture) || payout) && (
                  <span className="tx-links">
                    {paypalId(capture) && (
                      <a href={activity(capture)} target="_blank" rel="noreferrer">
                        Capture in PayPal ↗
                      </a>
                    )}
                    {payout && (
                      <a href={activity(payout)} target="_blank" rel="noreferrer">
                        Payout in PayPal ↗
                      </a>
                    )}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {!simulated && paid.length > 0 && (
        <p className="fine">
          PayPal links open the sandbox activity page; sign in with the sandbox merchant or Crew account to view it.
        </p>
      )}
    </section>
  );
}
