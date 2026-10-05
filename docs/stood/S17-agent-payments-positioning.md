# S17: Agent payments, mandates and code milestones

Status: product direction aligned with approved PR #24, 5 October 2026. A2A/AP2 and Yard integrations are planned; the profile is unit-tested with synthetic findings, not qualified runner or payment evidence.

## What each layer owns

| Layer | Responsibility | Stood status |
|---|---|---|
| A2A | Discover an agent, exchange tasks/messages and return artifacts | Planned integration; no Agent Card or protocol endpoint is shipped |
| AP2 | Express signed payment authority and constraints | Planned integration; Stood does not currently verify AP2 mandates |
| Stood | Bind evidence and deterministic acceptance rules to a milestone and explain RELEASE / REFUSE / WAIT | Pure rule profiles and sandbox foundations are implemented |
| PayPal | Authorise, capture, void and provide settlement status | Funded-hold adapter tested synthetically; financial HTTP remains off |

This mapping is Stood's proposed architecture, not protocol certification. Primary references checked 5 October 2026: [A2A specification](https://a2a-protocol.org/latest/specification/) and [AP2 specification](https://ap2-protocol.org/ap2/specification/). A task result does not itself prove payment authority or acceptance. The current local HMAC API is not an A2A or AP2 implementation.

## Intermediate and final code contracts

Freeze repository identity, base commit, exact signed acceptance-test hashes and required test IDs, allowed runner identities, mutation scope/threshold, payee, currency, budget and release conditions in the payer-approved allowance. Bind each runner attestation to that allowance, package and exact new commit. Count every required test, reject edits and skips, and report absent or malformed proof as WAIT. A low mutation score is WAIT, requiring stronger tests or review; it is not an inferred release.

code.milestone@1 requires six RULE findings: signed_tests, test_integrity, test_execution, new_commit, mutation_score and budget_mandate. Intermediate milestones release without a usage or buyer-touch finding. code.final@1 adds usage_release for final handover; missing outside usage or agreed buyer acceptance means WAIT. Definite contract violations refuse with a named reason. The frozen allowance selects the profile; the builder cannot switch it. Rule set 1.2.0 makes this distinction explicit. Older records restore in cancellation/reconciliation-only safe mode, preserving pending identities and confirmed facts. Agent buyer/builder labels never enter the decision function.

The profile is a rule contract, not a verifier. T-0159 must authenticate runner/usage signatures and derive the findings before code payments ship. Never accept submitted PASS results or run a customer's repository in the payments process. Signed tests alone do not establish test quality, signer independence or real use.

## The outside-signal rule

An agent buying from another agent cannot create an endlessly self-funded payment chain by asserting that its own downstream agent used the work. Each payout remains bounded by an externally funded mandate, an identified payee and independent acceptance/use evidence. Subcontracting is allowed within the mandate; circular invoices, agent self-attestations and internal task completion alone are insufficient release evidence. The anti-cycle provenance verifier is planned with T-0159, not claimed by the landing page examples.

## What can be shown today

The landing page can illustrate passing, edited, skipped and weak-test outcomes, with identical verdicts for humans and agents. The local API can create a signed DRAFT and replay synthetic fixtures. It cannot yet freeze a payer-approved code contract, receive authentic runner/use attestations or execute its payment through HTTP. A real demo must show actual sandbox objects and signed runner evidence before those capabilities are claimed.
