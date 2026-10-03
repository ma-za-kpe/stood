# T13: Observability and runbooks

## Signals

| Signal | Tool | Notes |
|---|---|---|
| Logs | pino JSON → Render logs (+ Grafana Cloud Loki free) | Correlation fields: `tranche_id`, `package_id`, `decision_id`, `paypal_debug_id`, `platform_ref`. PII-redacted |
| Traces | OpenTelemetry → Grafana Cloud Tempo (free) | Spans for each pipeline step and each PayPal call |
| Errors | Sentry (free developer plan) | Release-tagged with the release-please version |
| Business metrics | Postgres views → **AG Studio** reviewer dashboard | Decisions by outcome and field, **false-refusal rate**, median hold age, money held now, capture failures, reconciliation mismatches |
| Uptime | Postman monitor (15 min) + Render health checks | — |

## Alerts (to the maintainer by email / Slack via the notifier)

| Alert | Condition |
|---|---|
| Capture failed | Any `paypal_calls` capture with a non-2xx after retries |
| Reconciliation mismatch | Capture without a release, or release without capture after 3h |
| Hold near expiry | An authorisation older than 27 days without a decision |
| Webhook dead-letter | Any delivery exhausted |
| AI budget | > 80% of the daily Workers AI quota used |
| Demo down | Two consecutive monitor failures |

## Runbooks

### R1: Capture failed after release decision
1. Check `paypal_calls` for the tranche (status, `paypal_debug_id`).
2. If PayPal shows the capture as completed (Transaction Search), mark it reconciled. **Don't re-capture.**
3. If the authorisation expired, set the state to `EXPIRED` and notify the payer: "The hold ended before release. Nothing was paid." Ask for a new authorisation.
4. Otherwise retry once with the same `PayPal-Request-Id`, then escalate.

### R2: Capture without a Stood release (gate bypass)
1. Freeze the platform key (set to read-only).
2. Pull the order, `custom_id` and audit log. Identify who called PayPal.
3. Open a dispute or refund decision **with the payer**. Record an incident note in `docs/incidents/` (no personal data).

### R3: Demo is asleep or slow during judging
1. Hit `/health` and wait for the cold start (~1 min).
2. Check Neon (scale-to-zero resume) and the Render events tab.
3. If the free hours are exhausted, switch to partner credits (Render) and record it in `TASKS.md`.

### R4: Workers AI quota exhausted
- Expected behaviour: model checks return "uncertain", so decisions go to **WAIT**. Nothing is released.
- Option: flip `VISION_MODEL` to a backup provider (requires an ADR if it's paid).

### R5: Leaked secret
1. Revoke and rotate immediately (PayPal app secret / HMAC / R2 token).
2. Purge it from history only if it was committed (and treat it as compromised regardless).
3. Requalify with the CI contract tests. Log it in `TASKS.md`.
