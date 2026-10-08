# Security policy

Stood decides whether money moves. We take reports seriously.

## Reporting a vulnerability

- **Don't open a public issue.** Report privately through GitHub: <https://github.com/ma-za-kpe/stood/security/advisories/new> (Security → Report a vulnerability). Only the maintainers see the report.
- Include: affected version or commit, steps to reproduce, and impact (especially anything that could release, capture or void a payment without a valid decision).
- We aim to acknowledge within **72 hours**, confirm or reject the issue within **7 days**, and agree a fix and coordinated disclosure date with you (normally within **90 days**). We credit reporters who want credit.
- Published advisories: <https://github.com/ma-za-kpe/stood/security/advisories>.

## Scope

- In scope: this repository's code, workflows, and the hosted demo.
- The demo uses the **PayPal sandbox only**. No real money moves. Never test against real PayPal accounts or real personal data.

## Supported versions

Before 1.0.0, only the latest release is supported. After 1.0.0, the latest minor plus security fixes on the previous minor ([ADR-0006](docs/adr/0006-open-source-branching-strategy.md)).

## OpenSSF

Scorecard results: <https://scorecard.dev/viewer/?uri=github.com/ma-za-kpe/stood>. Prepared answers for the OpenSSF Best Practices badge: [docs/security/openssf-best-practices.md](docs/security/openssf-best-practices.md).
