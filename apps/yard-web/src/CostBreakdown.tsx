import type { CostLine } from '@stood/yard-domain';
import { costRows } from './cost-rows.js';

export function CostBreakdown({
  blueprint,
}: {
  blueprint: Parameters<typeof costRows>[0] & { costLines?: readonly CostLine[] | undefined };
}) {
  const costs = costRows(blueprint);
  if (!costs)
    return (
      <p role="alert">The costs in this draft don’t add up to your approved cap. Don’t sign it; ask for a revision.</p>
    );
  return (
    <section className="cost-breakdown" aria-labelledby="cost-breakdown-title">
      <h4 id="cost-breakdown-title">What this costs you</h4>
      <dl>
        {costs.rows.map((r) => (
          <div key={r.label}>
            <dt>{r.label}</dt>
            <dd>
              {r.amount} <span className="fine">{r.detail}</span>
            </dd>
          </div>
        ))}
      </dl>
      <p>
        <strong>Total: {costs.total}.</strong> Prices are fixed once you sign; a change needs a new version and your
        approval.
      </p>
    </section>
  );
}
