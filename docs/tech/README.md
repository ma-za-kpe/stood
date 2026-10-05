# Technical docs

Code milestones lead: frozen signed tests, commit package, budget mandate and outside usage release. The code profile and durable core are tested; runner, funding HTTP, Yard and A2A/AP2 remain planned. This index describes implementation and target design, with field work labelled as a scenario. Product intent is in [`../stood/`](../stood/). How we work is in [`../WAYS_OF_WORKING.md`](../WAYS_OF_WORKING.md).

| # | Doc | Covers |
|---|---|---|
| T01 | [Requirements](T01-requirements.md) | Functional (FR) and non-functional (NFR) requirements, constraints |
| T02 | [Architecture](T02-architecture.md) | C4 context / containers / components, sequences, state machine, cross-cutting |
| T03 | [Domain model and decision rules](T03-domain-model.md) | Aggregates, value objects, events, checks C1–C9, the decision function |
| T04 | [API specification](T04-api-spec.md) | REST v1, auth, idempotency, webhooks in and out, demo endpoints |
| T05 | [Data model and storage](T05-data-model.md) | Postgres schema, R2 layout, evidence index, retention |
| T06 | [PayPal integration](T06-paypal-integration.md) | Vault, AUTHORIZE / capture / void / reauthorise, timers, failures, sandbox |
| T07 | [Evidence pipeline](T07-evidence-pipeline.md) | Rules-first pipeline, evidence agent, near-duplicate search, Channel3 |
| T08 | [EyeOnSite: example scenario integration](T08-eyeonsite-integration.md) | **Where [EyeOnSite](https://github.com/ma-za-kpe/eyeonsite) calls Stood and how payments change** |
| T09 | [Tech stack](T09-tech-stack.md) | Open-source / free-tier choices and fallbacks |
| T10 | [Deployment](T10-deployment.md) | Where it runs (Render, Neon, R2, Workers AI, Astropods), CI/CD, free-tier risks |
| T11 | [Security and privacy](T11-security-privacy.md) | STRIDE, money-specific controls, data protection |
| T12 | [Testing and quality](T12-testing-and-quality.md) | Test layers, fixtures, gates, TDD order |
| T13 | [Observability and runbooks](T13-observability-and-runbooks.md) | Signals, alerts, R1–R5 runbooks |
| T14 | [Feature breakdown and milestones](T14-feature-breakdown-and-milestones.md) | Epics → features → FRs, versions 0.2.0 → 1.0.0 |
| T15 | [Docker and local development](T15-docker-and-local-dev.md) | Docker-only dev, images, compose stack, CI and Render parity |
