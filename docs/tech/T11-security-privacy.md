# T11: Security, privacy and threat model

Evidence attacks (GPS spoofing, recycled photos, collusion, prompt injection) are covered in [S11](../stood/S11-evidence-integrity.md). This page covers the **system**.

## Assets

1. The ability to **capture** money (the PayPal app secret, vault tokens).
2. Decision integrity (rules, rule-set version, stored inputs).
3. Evidence photos and locations (personal data: someone's property, sometimes faces).
4. Platform API keys and HMAC secrets.
5. Receipt links.

## Threats (STRIDE) and controls

| Threat | Example | Control |
|---|---|---|
| **S**poofing | Fake platform calls; fake PayPal webhooks | Bearer key + HMAC signature + timestamp skew. PayPal webhook signature verification. Reviewer OAuth |
| **T**ampering | Altered photos after upload; edited decision rows | sha256 + pHash stored at ingest, and recomputed against the platform pHash. Append-only `audit_log`. Decisions are immutable records |
| **R**epudiation | "I never approved this" / "the agent did it" | Vault approval at PayPal. Decision records with `decided_by`. PayPal `custom_id` binds the decision id. The dispute packet |
| **I**nformation disclosure | Public receipt leaks plot coordinates; photo URLs guessable | Receipts show distance, not coordinates. Private R2 with short-TTL signed URLs. No PII in logs (pino redaction) |
| **D**enial of service | Package floods burn the AI quota | Rate limits per key. Rules-first pipeline. A daily AI budget guard (exhausted → WAIT) |
| **E**levation of privilege | A prompt-injected model triggers a capture | **Runtime separation:** the evidence agent has no PayPal credentials. Model output is schema-validated. The money call is reachable only through the pure rule ([ADR-0003](../adr/0003-rules-move-money.md)) |

Additional money-specific controls:
- **Double capture:** `PayPal-Request-Id` idempotency + DB uniqueness + state checks.
- **Gate bypass:** reconciliation flags any PayPal capture without a Stood release decision.
- **Sandbox-only guard:** the app refuses to boot with a non-sandbox PayPal base URL.

## Privacy

- **Lawful basis / laws to respect:**
  - UK GDPR (payers in the UK).
  - **Ghana Data Protection Act 2012 (Act 843)** (inspectors and plots in Ghana).
  - Nigeria Data Protection Act 2023 and Kenya DPA 2019 when those corridors open.

  For the hackathon, only synthetic or consented data is used.
- **Minimise:**
  - Photos are only of the site.
  - Inspectors are told not to photograph people. The vision prompt flags faces → WAIT for reviewer redaction (later).
- **Retention:** 180 days for photos ([T05](T05-data-model.md#retention-demo)).
- **Data subject requests:** handled by the platform ([EyeOnSite](https://github.com/ma-za-kpe/eyeonsite) owns the users). Stood deletes by `platform_ref` on request (an admin endpoint, later).
- **Processors:** Render (EU), Neon (EU), Cloudflare (R2 / Workers AI), Astropods, Elastic (EU region), PayPal. Listed in `docs/sponsors/*` and a future privacy notice.
- **AI:** Workers AI. Cloudflare states it doesn't train on customer inputs. **Don't** use any provider whose free tier trains on inputs for evidence photos.

## Secrets management

See [T10 §Secrets](T10-deployment.md#secrets-and-config) and [WoW §11](../WAYS_OF_WORKING.md#11-security-and-secrets-open-source-edition). gitleaks runs at pre-commit and in CI.

## Supply chain

- Lockfile committed. `pnpm audit` in CI. Dependabot for Actions (and npm once code lands).
- GitHub Actions pinned to full SHAs. Read-only default token.
- No post-install scripts from unknown packages (`pnpm` `onlyBuiltDependencies` allowlist).
