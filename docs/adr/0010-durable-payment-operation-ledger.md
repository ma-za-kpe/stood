# ADR-0010: Persist payment operation identity before submission

> Historical framing (before the 5 Oct 2026 repositioning). See [S17](../stood/S17-agent-payments-positioning.md).

- **Status:** accepted
- **Date:** 2026-10-03

## Context and evidence

ADR-0009 requires reservation before a processor call. In-memory keys disappear on restart and cannot exclude a competing worker. T-0132 requires durable aggregate state and operations before PayPal wiring.

## Decision

Use the planned Drizzle/Postgres stack. A payment stream has a version; an operation records its immutable domain intent/key, provider request UUID, reservation version and current outcome. A partial unique index permits one RESERVED/AMBIGUOUS operation per tranche across capture, void and renewal. An append-only event table preserves outcome history; database triggers prevent identity rewrites and changes to resolved operations.

The transaction adapter must [lock the stream row](https://www.postgresql.org/docs/17/explicit-locking.html), verify its version, persist the UUID/reservation/event and commit before any processor call. Identical intent retries retain identity; ambiguity cannot free the slot. Processor policy and the tranche domain, rather than a storage row alone, establish a confirmed or definite-failure outcome.

Check in [generated forward migrations](https://orm.drizzle.team/docs/migrations) and custom guards. Reuse Compose's pinned Postgres for integration tests, creating/dropping only randomly named test databases on that fixed local service. No arbitrary DATABASE_URL or Docker socket reaches the tests.

## Alternatives considered

In-memory reservations cannot survive restarts. A process lock cannot exclude another instance. A unique request UUID without an unresolved-operation constraint does not prevent a competing void. Testcontainers would add a second database lifecycle and Docker-socket access to the existing container test toolchain.

## Risks and controls

Schema/harness T-0139 and transaction adapter T-0140 are separate review slices. Neither completes T-0132: aggregate state, original hold/renewal history, retry counters and atomic coupling remain required. There is no payment executor, reconciliation or credential onboarding yet. DB integration coverage is gated separately; unit/domain coverage is not used as database evidence.

## Reversal condition

A processor needs multiple simultaneous effects on one tranche. Extend the model with explicit invariants and an ADR before relaxing exclusivity.
