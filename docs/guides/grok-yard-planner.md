# xAI Grok: plan a Yard project within a spend cap

Yard's Foreman uses Grok to propose a blueprint from a buyer's brief. Grok proposes milestones, risks and acceptance-case data; Yard validates the schema and derives amounts and due dates from the buyer's fixed budget and deadline. It never writes tests or has PayPal credentials. Stood's deterministic rules and verified provider results retain authority over release.

## Configure and run

1. Create a project API key in the [xAI console](https://console.x.ai/) and set a hard account/project limit there. Keep it server-side.
2. Set `GROK_PLANNER_API_KEY`, `GROK_PLANNER_MODEL` (optional; default `grok-build-0.1`) and `GROK_DAILY_BUDGET_USD` (USD 0.01–5, default 0.50) in the Yard service environment. For hosted planning, configure the Yard GitHub App and repository settings too; Foreman remains off unless both model and repository access are valid.
3. Run `scripts/dev planner-check` to make five bounded live drafts. It costs up to the guard's documented test cap; use only a disposable test brief. The command forwards only the Grok settings it needs into the test container.
4. In a hosted demo, open a disposable buyer intake and request one blueprint. Check the output against the fixed cap/deadline and confirm the model log contains usage counts/cost, not the brief or key.

The existing local qualification exercises the Grok response against the shared planner contract. The dated setup record lists the model's observed price; prices change, so verify [xAI's model/pricing documentation](https://docs.x.ai/docs/models) before setting a cap. The per-call output is capped at 4,000 tokens, and the Postgres spend guard reserves worst-case cost before the request. It does not retry a failed model call blindly.

## Data, limits and troubleshooting

The planner prompt contains the project description and selected product choices. It omits sign-off name/email, budget, repository credentials and deadline. The server rejects malformed output; if the provider is unavailable, the buyer sees a recoverable planning state and money is not affected. A 5xx or timed-out plan/revision now explains that xAI may be unavailable or out of quota, confirms the private brief is still saved, and points to quota checks and the recovery action. Stood does not silently switch to a second paid provider or invent a generic blueprint; any alternate model or template must be explicitly configured and reviewed for cost and data handling first. The spend counter is shared in Postgres across restarts. “Foreman off” in `/health` means a required key, spend cap or GitHub App setting is absent; it does not mean Yard intake is unavailable.

Local adapter and contract evidence is recorded in `services/yard-foreman/src/adapters/grok/grok.test.ts` and `planner-contract.test.ts`. Run `corepack pnpm exec vitest run services/yard-foreman/src/adapters/grok/grok.test.ts services/yard-foreman/src/planner-contract.test.ts`. The branch itself does not claim a new live Grok qualification; use `scripts/dev planner-check` to establish one against the configured provider.
