# ADR-0001: Record architecture decisions

> Historical framing (before the 5 Oct 2026 repositioning). See [S17](../stood/S17-agent-payments-positioning.md).

- **Status:** accepted
- **Date:** 2026-10-03

## Context and evidence

Stood moves people's money and is built in the open, partly by AI coding agents. Decisions made in chat get lost. The speedo project showed that written, append-only decision records stop silent drift and keep reviewers and agents aligned.

## Decision

Record every material decision as an ADR in `docs/adr/` using [the template](0000-template.md). ADRs are append-only. To change a decision, write a new ADR that supersedes the old one.

## Alternatives considered

- Decisions only in PR descriptions: rejected, because they're hard to find and not versioned with the docs.
- A wiki: rejected, because it lives outside the repo and isn't reviewed in PRs.

## Risks and controls

Overhead → keep ADRs to one page and write them only for decisions that are hard to reverse or that affect money, security or architecture.

## Reversal condition

If ADRs go stale (more than two decisions found un-recorded at a release), revisit the process.
