# Technical docs

Code milestones lead: frozen signed tests, commit package, budget mandate and outside usage release. The code profile, durable core, signing and funding HTTP/worker path run on the PayPal sandbox. Yard’s hosted Board and private intake are available; connecting its Foreman and payment adapter is next. The runner and A2A/AP2 remain target designs. This index describes implementation and target design, with field work labelled as a scenario. Product intent is in [`../stood/`](../stood/). How we work is in [`../WAYS_OF_WORKING.md`](../WAYS_OF_WORKING.md).

Live entry points: [Stood website](https://ma-za-kpe.github.io/stood/), [Yard companion site](https://ma-za-kpe.github.io/stood/yard/), [hosted Yard sign-in](https://stood-yard-api.onrender.com/app/), [Stood health](https://stood-api.onrender.com/health) and [Yard health](https://stood-yard-api.onrender.com/health). [Progress and screenshot guidance (#108)](https://github.com/ma-za-kpe/stood/issues/108) records the deployed C2 batch; [#76](https://github.com/ma-za-kpe/stood/issues/76) tracks hosted Foreman and Yard adapters.

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
| T16 | [PayPal AI Toolkit and MCP](T16-paypal-ai-toolkit.md) | How the Toolkit skill, commands and sandbox MCP server are used, and why they never move Stood's money |
