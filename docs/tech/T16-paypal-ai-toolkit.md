# T16: How we use the PayPal AI Toolkit and its sandbox MCP server

Status (2026-10-07): the Toolkit plugin is installed in the team's Claude Code. The sandbox access token is **not configured yet**, so no MCP tool has been called. Each use below is marked **planned** until its evidence is recorded in [`TASKS.md`](../../TASKS.md) under T-0246.

## The one rule

The Toolkit and its MCP server are **development and verification tools**. They are never in Stood's money path.

- Stood moves money only through its own server-side PayPal adapter, its deterministic release rules and the signed Stood API. An AI agent calling an MCP tool never authorises, captures or voids a Stood tranche.
- The MCP token is a short-lived **sandbox** token in the developer's own `~/.claude/settings.json`. It is never in the product, CI, Render, the repository or chat.

This keeps the product's central promise intact: rules move money, AI only helps. The rule also stops the MCP server from becoming a second, unaudited way to change money state.

## What we use, and why

| Toolkit part | How we use it | Status |
|---|---|---|
| `paypal-best-practices` skill and its pre-edit hook | Loads automatically whenever code under `services/api/src/adapters/payments-paypal/` or the simulator changes. We check our Orders v2 authorize / capture / void / reauthorize and Vault usage against PayPal's current recommendations. | Active from the next PayPal code change |
| `/paypal:doctor` | One scan of the repository before sandbox qualification. Findings become tasks or recorded "not applicable" decisions. | Planned |
| `/paypal:explain-error` | Every unexpected sandbox error during qualification (T-0222) is explained and mapped to Stood's error taxonomy, or added to the simulator's fault list. | Planned |
| `/paypal:test-accounts`, `/paypal:sandbox` | Choose sandbox buyer and seller accounts and webhook scenarios for the live-sandbox E2E (T-0234). | Planned |
| MCP `get_order` | **Second witness.** After each qualification scenario, an agent reads the PayPal order Stood created and compares status, amount and authorization/capture IDs with Stood's tranche record. A mismatch fails the scenario. | Planned |
| MCP `list_transactions` | **Independent reconciliation check.** Cross-checks the T-0155 `auditCaptures` result (capture without release, release without capture, amount mismatch, duplicates) against PayPal's own reporting for the same window. | Planned |
| MCP `list_disputes`, `get_dispute` | During the sandbox E2E, confirms that no dispute exists before a release, and records any dispute opened on a test buyer account. | Planned |
| MCP `create_order`, `pay_order`, `create_refund` | **Not used against Stood's orders.** These would change money state outside Stood's rules. They may only be used to make unrelated fixture data in the sandbox, labelled as such. | Excluded by the rule above |

## How a developer sets it up

1. In Claude Code: `/plugin install paypal@claude-plugins-official`, then `/reload-plugins`.
2. In your own terminal, **not** in a Claude Code `!` command (its output would land in the conversation), mint a sandbox token with the sandbox app's client ID and secret:

   ```bash
   curl -s -X POST https://api-m.sandbox.paypal.com/v1/oauth2/token \
     -u "$PAYPAL_CLIENT_ID:$PAYPAL_CLIENT_SECRET" -d grant_type=client_credentials | jq -r .access_token
   ```

3. Put the single-line value in the `env` block of `~/.claude/settings.json` as `PAYPAL_SANDBOX_ACCESS_TOKEN`, then fully quit and reopen Claude Code.
4. Run `/paypal:setup`. Tokens expire within about 8–9 hours; on a 401, run `/paypal:setup refresh`.

## Recording evidence

Each MCP check stores a sanitised record next to the scenario's recorded exchange (T-0224). The record contains the tool name, the PayPal object IDs, the compared fields and the result, but no tokens and no buyer personal data. The hackathon "Built with" section points to this page and to those records.
