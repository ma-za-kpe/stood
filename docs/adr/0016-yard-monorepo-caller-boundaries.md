# ADR-0016: Yard shares tooling, never payment authority

- Status: Accepted architecture; runtime implementation remains planned
- Date: 2026-10-05
- Tasks: T-0174, T-0175–T-0192

## Context

The reviewed [Yard documents](../yard/README.md) put the Foreman, Board and Crew beside Stood in one monorepo. Earlier T-0168 and T02 described a separate repository. Sharing a repository must not create a private path to declaring a milestone paid.

## Decision

Yard uses the public authenticated Stood HTTP contract through a future `packages/stood-sdk`. Yard services, its web app and the SDK cannot import `services/api`. The Foreman returns plans; it cannot import Yard's action coordinator, Crew, payment SDK or direct filesystem/process/network modules. Dependency-cruiser enforces these import constraints, with real graph fixtures proving forbidden and allowed edges. This is an import boundary, not proof of runtime isolation: injected tools, transitive capabilities and global APIs require qualification before a planning agent runs.

Yard owns a separate Postgres schema and restricted role with no grants on Stood tables. Credentials, jobs and deployments are separate. The Crew is an ordinary Board caller with no database credentials or privileged payment treatment. No schema, role, SDK, agent runtime or GPU is created by this ADR.

The Foreman and human-builder Board ship before a scripted demo Crew; the GPU Crew is last. Intermediate work uses `code.milestone@1`; final handover uses `code.final@1`. Signed fake reports and metadata-only intake are contract evidence, not qualified execution or funding. Buyer approval, dispatch, runner qualification and provider-recipient funding remain prerequisites to claims of actual paid work.

## Consequences

The task ledger allocates the Y-A–Y-E rounds and supersedes T-0168's separate-repository plan. Fees, stacks, vetting, outside signals, model choice and trademark questions remain in Y16. The Yard page and UI remain planned. No purchase or model selection follows from documenting these boundaries.
