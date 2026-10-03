# ADR-0003: Rules move money, with a hexagonal money boundary

- **Status:** accepted
- **Date:** 2026-10-03

## Context and evidence

- Signed agent payments can still be the wrong decision ("Whisper attacks" on AP2, arXiv 2609.11757).
- Photos can carry prompt-injection text.
- The PayPal Agent Toolkit has no human-confirmation gate.

See [S11](../stood/S11-evidence-integrity.md) and [S13](../stood/S13-sponsor-integration.md).

## Decision

- The **Decision** context is pure, deterministic rules over value objects. It returns release / refuse / wait with a named field.
- Models (the evidence agent) return **findings with confidence** only. Low confidence results in **wait**, never refuse.
- Only the `payments` adapter imports the PayPal SDK. The evidence agent runs in a separate runtime (Astropods) with **no** PayPal credentials.
- A pre-commit check enforces the import boundary.

## Alternatives considered

- Let an LLM agent call PayPal tools directly with guardrails in prompts: rejected. Prompts aren't a security boundary.
- A single runtime for everything: rejected. A compromised model would sit next to the payment credentials.

## Risks and controls

- Rules too rigid, causing false refusals → track the false-refusal rate, route uncertainty to wait and a human reviewer, and keep every refusal explainable by a named field.

## Reversal condition

None foreseen for the money path. Revisit model placement only if a model is formally verified for a specific bounded check.
