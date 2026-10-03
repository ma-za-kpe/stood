# ADR-0007: Stood is domain-agnostic; evidence profiles

- **Status:** accepted
- **Date:** 2026-10-03

## Context and evidence

Stood must plug into many callers: construction (EyeOnSite), freelance, claims, lending, rentals, grants, trade and agents. The v0 design hard-coded "plot" and "stage". See [S16](../stood/S16-use-cases-and-evidence-profiles.md).

## Decision

- The core knows only **allowances, milestones, holds, packages, checks and decisions**.
- Industry knowledge lives in **evidence profiles**: versioned compositions of generic checks with parameters (`construction.stage@1`, `freelance.milestone@1`, …).
- Profiles can declare an **effect map** (default pass → capture, fail → void; deposits invert it).
- The decision rule and the money boundary are unchanged.

## Alternatives considered

- A separate product per vertical: rejected. It duplicates the money path and the risk.
- Caller-supplied code or scripts: rejected. That's arbitrary code inside the money gate.

## Risks and controls

- The profile surface grows into a programming language → only parameters, no expressions. New check types need an ADR and full tests.
- Inverted effects confuse → only declared, versioned profiles may invert. Partial capture always needs a human.

## Reversal condition

A vertical needs logic that can't be expressed as a check plus parameters → evaluate a dedicated adapter, never in-core code.
