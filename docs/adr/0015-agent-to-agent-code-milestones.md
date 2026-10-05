# ADR-0015: Reposition on agent-to-agent code milestones

- Status: Accepted product direction; implementation qualification remains task-scoped
- Date: 2026-10-05
- Tasks: T-0157, T-0159, T-0160–T-0169; issue #29

## Context

The approved landing page leads with **Agents pay agents. Only when the work stands.** Core docs still framed field inspections as the main product. Existing ADR-0014 already records atomic platform drafts; it must not be overwritten.

## Decision

Code milestones become the lead story. Adaeze or her buying agent agrees frozen signed acceptance tests, exact repository/base commit, operator/payee and budget mandate; a builder submits a new commit package. Test integrity, complete execution, new work, mutation quality, budget and agreed independent outside usage determine payment eligibility, regardless of human/agent labels. Examples use USD: $1,200 milestone, $4,000 cap.

The existing generic evidence-profile design remains [ADR-0007](0007-domain-agnostic-evidence-profiles.md). EyeOnSite becomes a linked site-visit scenario. This decision supersedes no ADR or money-path invariant. Research, audit log, sources and existing ADR bodies remain unchanged except a historical-framing banner linking [S17](../stood/S17-agent-payments-positioning.md).

Yard, the isolated signed test runner, trusted report ingestion and A2A/AP2 surfaces remain explicitly planned. Positioning is not protocol conformance or real payment evidence. Separate tasks and a future sandbox-technology ADR qualify execution, signatures, read-only fetching, outside demand and operator authority before code payments ship. The runner executes no network or secrets and cannot reach the payment service.

## Consequences

Docs, default synthetic demo fixtures and PR checklist lead with code evidence. Historical field fixtures and general location/geofence tests remain valid. Synthetic results cannot prove a test ran or a provider settled. Funding, missed-send recovery, renewal evidence queuing and actual sandbox qualification remain blockers to enabling financial HTTP. Issue closure requires the documented audit and addendum, without hiding unfinished implementation tasks.
