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

## Status of the MCP server, and the workaround

Since 2026-10-08 every sandbox MCP tool we tried (`list_invoices`, `list_transactions`, `list_disputes`) returns `PAYPAL_API_SETUP_ERROR: Unsupported cache mode: default`, with a fresh token and a working connection. Reported upstream as [paypal/AI-Toolkit#34](https://github.com/paypal/AI-Toolkit/issues/34).

Until it is fixed, [`tools/paypal-witness`](../../tools/paypal-witness/witness.py) does the second-witness job: a read-only Python script (standard library only, a separate code path from Stood's TypeScript SDK adapter) that reads an order, a Transaction Search window or the dispute list straight from the PayPal sandbox REST API. It prints ids, amounts and statuses only, never personal data or tokens, and accepts only `https://api-m.sandbox.paypal.com`.

```bash
tools/paypal-witness/witness.py order ORDER_ID
tools/paypal-witness/witness.py transactions 2026-10-01T00:00:00Z 2026-10-08T23:59:59Z
tools/paypal-witness/witness.py disputes
```

When the MCP server works again, the same checks move back to `get_order`, `list_transactions` and `list_disputes`.

## How a developer sets it up

1. In Claude Code: `/plugin install paypal@claude-plugins-official`, then `/reload-plugins`.
2. In your own terminal, **not** in a Claude Code `!` command (its output would land in the conversation), mint a sandbox token with the sandbox app's client ID and secret:

   ```bash
   curl -s -X POST https://api-m.sandbox.paypal.com/v1/oauth2/token \
     -u "$PAYPAL_CLIENT_ID:$PAYPAL_CLIENT_SECRET" -d grant_type=client_credentials | jq -r .access_token
   ```

3. Put the single-line value in the `env` block of `~/.claude/settings.json` as `PAYPAL_SANDBOX_ACCESS_TOKEN`, then fully quit and reopen Claude Code.
4. Run `/paypal:setup`. Tokens expire within about 8–9 hours; on a 401, run `/paypal:setup refresh`.
5. Or let [`tools/paypal-mcp-token`](../../tools/paypal-mcp-token/README.md) do steps 2–3 automatically (at login, 07:00 daily and every 8 hours). It is installed on the owner's machine.

## Recording evidence

Each MCP check stores a sanitised record next to the scenario's recorded exchange (T-0224). The record contains the tool name, the PayPal object IDs, the compared fields and the result, but no tokens and no buyer personal data. The hackathon "Built with" section points to this page and to those records.

## APIMatic PayPal Context Plugin

The [Context Plugin](https://github.com/paypaldev/server-sdk-context-plugin-preview) gives coding agents authoritative knowledge of the PayPal Server SDK that Stood already pins (`@paypal/paypal-server-sdk` 2.5.0). Installed 2026-10-08 (`npx context-plugins install …`) into Claude Code, VS Code and Codex as `paypal@context-plugins-local`.

### What we built with it

| Change | What the plugin's TypeScript guidance settled | Evidence |
|---|---|---|
| T-0155: the reconciliation audit reads PayPal **Transaction Search** through the SDK's `TransactionSearchController` instead of a hand-written HTTP client (`services/api/src/adapters/payments-paypal/sdk.ts`, `captures()`) | Controllers are **constructed** from the client (`new TransactionSearchController(client)`), not reached through it; `searchTransactions` is generated in the **options-object form** because it has several optional parameters, so it is called as `searchTransactions({ startDate, endDate, fields, pageSize, page })`; non-2xx responses throw `ApiError`, whose body carries PayPal's `debug_id` | `simulator-transactions.test.ts` (paging across 3 captures with page size 2, the 31-day window, an outage reported with its debug id) and the mock money flow, whose 9 scenarios now end with an audit through the SDK |

How it was used, honestly: the plugin was installed mid-session, after the coding agent's session had started, so its skills were not loaded as live skills. The agent read the plugin's TypeScript skill files (`typescript-calling-endpoints`, error-handling, models) directly and followed them, then confirmed each call against the SDK's own source in `src/controllers/`, which the plugin names as authoritative.
