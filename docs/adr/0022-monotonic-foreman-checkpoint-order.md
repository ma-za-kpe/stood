# ADR-0022: Monotonic Foreman checkpoint order

**Status:** accepted, pre-deployment implementation.

## Context

The full gate intermittently restored the previous review version during rapid revisions. A deterministic 100 ms host-clock rollback reproduced it with MemorySaver and real Postgres. The pinned `@langchain/langgraph-checkpoint` 1.1.5 generator uses wall-clock UUIDv6 IDs; both stores choose their latest checkpoint by ID order. Its sub-millisecond counter does not clamp a backward millisecond value. Background checkpoint timing was investigated, but this failure is ID ordering, not an assumption that invoke returns before persistence.

Clamping within one process alone is insufficient: a restarted process can have an earlier wall clock than the persisted parent.

## Decision

Pin a pnpm patch for the dependency's ESM/CommonJS ID generator and declarations. Clamp milliseconds to the maximum of the host clock, the process's previous value and an optional persisted floor. Preserve the existing counter and overflow behavior. Before continuing a Foreman checkpoint, decode its validated UUIDv6 timestamp and seed the generator above that checkpoint's millisecond. Reject an incompatible ID rather than generating new checkpoints behind it.

These IDs are opaque logical ordering keys. They are never financial timestamps. Intake creation/deadlines, hold expiry, capture margins and provider reconciliation continue using their configured server clock. No checkpoint or payment history is rewritten, no model work runs on an ordinary read, and the change does not enable signing, execution or payments. It prevents new out-of-order writes; it is not a repair of already corrupted checkpoint history.

## Evidence and maintenance

Memory and real-Postgres rollback tests fail before the fix. A fresh Node process first demonstrates that a persisted floor is necessary. The Postgres test compiles the trusted Foreman into a temporary directory, starts a separate process with an earlier clock, revises through the restricted runtime role, then restores and approves its newest review from another connection. Removing the seed makes that test fail. The worker has no migration grants; its connection targets the randomly named throwaway database. No buyer code executes.

The patch is declared in pnpm-workspace.yaml and integrity-bound in the lockfile, so frozen installs apply it consistently. Keep both module formats and declarations in sync. Remove it only with an upstream version that passes the rollback and fresh-process regressions. The upstream [checkpoint package](https://github.com/langchain-ai/langgraphjs/tree/main/libs/checkpoint) remains the source; this local patch changes only its ID ordering behavior.
