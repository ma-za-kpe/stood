# ADR-0017: The real Crew is an external service

- Status: Accepted product boundary; service qualification remains planned
- Date: 2026-10-05
- Task: T-0193

## Context

Reviewed [Y21](../yard/Y21-crew-service-contract.md) moves the real Crew into a separate closed project operated on Vast.ai. ADR-0016's planned monorepo Crew entry is superseded; Stood, Yard's Board and Foreman remain in this repository.

## Decision

This repository contains only Crew contracts and explicitly labelled test fakes. Production Crew implementations cannot enter the dependency graph. The external Crew uses the same authenticated public Board as every builder; dispatch nudges confer no claim or payment authority. This repository may qualify the endpoint contract without selecting models, operating GPUs or importing Crew internals.

No database, buyer-secret, PayPal or privileged payment access is granted by the service boundary. Being in another repository does not prove isolation: public authentication, permissions, lease enforcement and deployment credential tests remain required. T-0191 supplies a fake and contract specification; the real Crew's implementation backlog lives in its closed project.

## Consequences

Y11/Y15 and TASKS reflect this boundary. The real-time event model, test-key handling and hybrid hosting in Y18–Y20 remain planned. A reachable health URL alone cannot establish buyer ownership or independent usage; T-0166 must qualify that proof before final release.
