# ADR-0024: In the sandbox, the CI gate reviews agent-written code

- **Status:** accepted
- **Date:** 2026-10-08
- **Deciders:** product owner (decision), engineer (record)

## Context and evidence

[WoW §12](../WAYS_OF_WORKING.md#12-parallel-work-people-and-agents) said that money-path code written by an agent gets human review before merge. Since 2026-10-06 the engineer on this project is an AI agent, and the owner is the only human maintainer. In practice, agent-written pull requests touching payments, reconciliation and the SDK (for example #55 and #70) were merged on green CI without a human review, which the policy did not allow.

On 2026-10-08 the owner decided not to review pull requests before merge, because everything runs on the PayPal **sandbox** during the hackathon and no real money can move.

## Decision

While Stood runs only against the PayPal sandbox and simulators, an agent-written pull request merges when **all required CI checks pass**, without waiting for a human review. That includes money-path code. The checks are the review:

- the full product gate (strict types, the dependency-cruiser money boundary, 100% coverage on the domain packages, all tests, real-Postgres tests),
- the mock network scenarios and site browser checks,
- every pre-commit hook (secrets, workflow security, lint),
- Conventional titles and DCO sign-off.

Every money-path change still starts with a failing test (WoW §4) and states its evidence tier in `TASKS.md`. The owner can review any pull request after merge and reopen work through an issue.

## Alternatives considered

- **Owner reviews every money-path pull request:** the policy as written; rejected by the owner for hackathon speed while no real money is at risk.
- **Change nothing and keep merging:** leaves the documented policy and practice in conflict, which this repository does not allow (WoW §2).

## Risks and controls

- A defect in money logic could merge unseen. Controls: sandbox only (the PayPal adapter is hard-wired to `Environment.Sandbox` and refuses any other base URL or SDK destination, `services/api/src/adapters/payments-paypal/sdk.ts`), the money boundary check, 100% domain coverage, idempotency keys on every money command, and reconciliation.
- Reviewers outside the project may expect human review. Control: this ADR and WoW §12 say plainly what happens.

## Reversal condition

This decision ends, and human review of money-path code becomes required again, as soon as **any** of these happens: a live PayPal app or real money is planned, a second maintainer joins, or the owner asks for reviews.
