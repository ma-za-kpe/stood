# Zapier: deliver Yard notices through a Catch Hook

This integration sends existing Yard notices to a Zapier Catch Hook. It is outbound-only: Zapier cannot call Yard or Stood through this adapter. Durable notice keys, a database lease and the event cursor prevent ordinary duplicate delivery; delivery is at least once, so the receiving Zap should also deduplicate on `key`.

## Set up a Zap

1. In Zapier, create a Zap with **Webhooks by Zapier → Catch Hook** as the trigger and copy its HTTPS Catch Hook URL. Treat the full URL as a password: anyone who has it can trigger the Zap.
2. Configure the next Zap step to send the notice to a destination you control. Start with a test-only destination and avoid forwarding project descriptions or credentials.
3. Add `YARD_ZAPIER_CATCH_HOOK_URL` to the Yard service environment. Add `YARD_NOTICE_CONTACTS_JSON` as a JSON object mapping Yard actor ids to exact recipient email addresses, for example `{"buyer":"buyer@example.invalid","crew":"crew@example.invalid"}`. Use real addresses only in the private service settings.
4. Restart/deploy Yard. The integration stays off unless both values are valid. Startup notes state only that configuration is missing or invalid; they never echo the hook URL.
5. Trigger an existing Yard notice in a sandbox project and verify the Catch Hook receives its stable key, recipient, subject and notice text. Run `corepack pnpm exec vitest run services/yard-api/src/runtime.test.ts services/yard-api/src/adapters/browser/ports.test.ts services/yard-api/src/application/notifications.test.ts` for local qualification.

Zapier documents the [Catch Hook trigger](https://help.zapier.com/hc/en-us/articles/8496288690317-How-to-get-started-with-Webhooks-by-Zapier) and warns that webhook URLs are unique. Check current [Zapier plans and task limits](https://zapier.com/pricing); this repository does not assume a free tier or quote a price.

## Data and delivery behavior

The recipient map is an allow-list keyed by Yard actor id. The worker derives notices from Board events, claims a durable key, sends one JSON POST, marks it delivered only on a successful HTTP response, and retries after a failure or expired lease. The HTTP adapter has a five-second timeout and refuses redirects. The recipient still needs to protect the Zap's destination: the hook can contain buyer/builder names, milestone text, amounts and provider references already present in the notice.

The worker scans durable notices every minute. There is no guarantee of exactly-once delivery across a network failure: the receiver can accept a POST and the response can be lost. Deduplicate by `key`. If the hook is disabled/deleted, Zapier may return an error; restore the Zap or remove the environment values to disable delivery. Never paste the Catch Hook URL into a ticket or commit it.

## What is tested and what is not

Local tests cover malformed recipient maps, refusing an unsafe/non-Zapier URL, the disabled-by-default state, the scheduled job when both settings are present, and retryable webhook failure. The branch does not contain a live Catch Hook URL and did not trigger a real Zapier Zap. Before production use, send a synthetic notice to a private test Zap and confirm destination access controls and duplicate handling.
