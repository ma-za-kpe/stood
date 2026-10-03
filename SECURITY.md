# Security policy

Stood decides whether money moves. We take reports seriously.

## Reporting a vulnerability

- **Don't open a public issue.** Use GitHub's **private vulnerability reporting** (Security → Report a vulnerability) on this repository.
- Include: affected version or commit, steps to reproduce, and impact (especially anything that could release, capture or void a payment without a valid decision).
- We aim to acknowledge within **72 hours** and to agree a fix and disclosure timeline with you.

## Scope

- In scope: this repository's code, workflows, and the hosted demo.
- The demo uses the **PayPal sandbox only**. No real money moves. Never test against real PayPal accounts or real personal data.

## Supported versions

Before 1.0.0, only the latest release is supported. After 1.0.0, the latest minor plus security fixes on the previous minor ([ADR-0006](docs/adr/0006-open-source-branching-strategy.md)).
