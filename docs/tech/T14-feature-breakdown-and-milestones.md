# T14: Feature breakdown and milestones

Versions are release artifacts, not proof that every planned feature shipped. v0.2.0 released on 5 October 2026 with tested domain/storage, guarded funded-hold adapter, signed DRAFT API and landing page. Money HTTP, funding, runner and agent surfaces remain planned.

## Current epics and exit evidence

| Epic | Work / tasks | Required evidence |
|---|---|---|
| Contract and docs | T-0157, T-0160–T-0163, T-0169 | Profile and synthetic fixtures tested; entrypoints aligned; provenance preserved |
| Funding and recovery | T-0154, T-0158, T-0137, T-0156 | Atomic approval/authorisation, bounded missed-send recovery, renewal queue, tenant-safe HTTP; fake-provider/DB tests then actual sandbox |
| Trusted code evidence | T-0159, T-0164, T-0165 | Frozen manifest, read-only fetch, qualified isolated runner and signed exact-commit/mutation report |
| Usage release | T-0166 | Independent outside-authority receipt, replay protection and agreed buyer acceptance |
| Agent/operator flow | T-0167, T-0168 | Pinned A2A/AP2 contracts, bounded Yard subcontract, identified operators and qualified integration |
| Review and delivery | T-0142, T-0155; receipts/webhooks/Gantt backlog | Visible owned unresolved rows, delivered alerts, confirmed money clauses and safe dispute packet |
| Scenario integration | EyeOnSite T08 | Field provenance/model qualification and honest fixture path; not the lead story |

## Delivery cadence

At least five tasks per round, one signed Conventional commit per task and one reviewed PR. Tests fail first for money changes. Dates are targets, never evidence. Before the submission target, the six S09 beats need actual runner/provider/operator proof; unbuilt Yard/A2A/AP2 remains a labelled storyboard. Do not enable payment HTTP until missed-send recovery, funding/reconciliation and real sandbox qualification pass.
