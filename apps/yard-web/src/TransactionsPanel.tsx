import type { ProjectRoom } from './project-state.js';

const money = (minor: number, currency: string) =>
  new Intl.NumberFormat('en', { style: 'currency', currency }).format(minor / 100);

// Proof of payment, one row per task Stood has paid. Every reference comes from Stood's matched
// settlement record; this panel never invents a payment.
export function TransactionsPanel({ room, simulated }: { room: ProjectRoom; simulated: boolean }) {
  const paid = room.orders.filter((o) => o.state === 'PAID' && o.payment);
  const total = paid.reduce((sum, o) => sum + (o.payment?.minor ?? 0), 0),
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
        <p className="fine">Nothing paid yet. A row appears the moment Stood captures a task.</p>
      ) : (
        <ol>
          {paid.map((o) => (
            <li key={o.id}>
              <span className="tx-name">{o.name}</span>
              <span className="tx-amount">{money(o.payment?.minor ?? 0, room.currency)}</span>
              <code className="tx-ref" title={o.payment?.reference}>
                {o.payment?.reference}
              </code>
              <span className="tx-kind">Capture · {simulated ? 'sandbox simulator' : 'PayPal sandbox'}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
