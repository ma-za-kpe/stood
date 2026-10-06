# ADR-0019: Yard starts with a free pilot, then a visible platform fee

Date: 2026-10-06. Status: accepted product direction; charging is not implemented.

## Context

The product owner chose a free pilot followed by a platform fee. Yard and Stood currently demonstrate simulated work and payments. Provider credentials and sandbox qualification are still pending. A free platform must not imply that a builder's work or an outside provider's services are free.

## Decision

Yard starts with a free pilot: its platform fee is $0. The simulated demo incurs no builder payment or simulated provider charge. Any later pilot that uses actual provider services must disclose their costs before the buyer approves them.

After the pilot, Yard may charge a visible platform fee. The rate, calculation basis, recipient, refund treatment and start date remain product-owner decisions before charging is enabled. This ADR authorises no percentage or automatic switch to paid pricing.

The buyer's blueprint must show builder milestone budgets, the Yard platform fee and any preview or provider costs as separate line items, with the currency and total commitment. Estimated costs must identify their estimate and limit; recurring hosting costs must identify who pays and when. A $0 fee must be shown explicitly. The total must respect the buyer's approved cap, and fees must never silently reduce a builder's agreed milestone payment.

The buyer sees the full breakdown before signing. Existing signed terms remain unchanged when pricing changes. A revised price requires a new version and buyer approval. Fees must not be added to Stood's capture amount without the corresponding approved mandate and supported payment workflow.

Yard's fee is distinct from any Stood or payment-provider fee. This decision does not set their pricing or remove provider charges. The product must name each charge once and identify its recipient, avoiding duplicate or hidden platform charges.

## Alternatives

A fee from the first demonstration would require pricing and charging implementation before the pilot. Permanently free Yard would contradict the chosen direction. An undisclosed deduction from milestone payouts would change the builder's agreed compensation.

## Consequences and reversal

T-0216 now has an agreed pricing direction. Blueprint cost-line schemas, UI disclosure, cap checks and tests remain required before that task closes. Real-provider costs, fee configuration and charging need qualification before activation. A later change in direction requires a new ADR and cannot rewrite existing signed terms.

The pre-key batch remains independent of this future fee rate. Credentials are requested at the Hosting and credentials checkpoint after the batch is ready; this decision does not declare that checkpoint reached.
