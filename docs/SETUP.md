# How Stood is set up (sandbox)

This is the record of the hosted sandbox setup done on 7–8 October 2026: every account, service, variable name and decision, and how to repeat it. It names **where** each value lives, never the value. For the full key inventory and the tests that wait on keys, see [`HANDOFF.md`](HANDOFF.md). For the target architecture, see [T10](tech/T10-deployment.md). Keep this page current: every change to hosting, keys or accounts updates it in the same PR.

**Sandbox only.** No live PayPal app exists. `PROVIDER_PAYPAL=live` means "talk to the real PayPal **sandbox**", never real money.

## 1. What runs where

| Piece | Where | Plan | Region | Notes |
|---|---|---|---|---|
| `stood-api` | Render web service (Docker, `Dockerfile` target `api`) | Free | Frankfurt | `https://stood-api.onrender.com`, health at `/health`. Sleeps after about 15 minutes idle |
| `stood-reconciler` | Render background worker (same image, `dist/reconcile-cli.js`) | **Starter (paid, about $7/month)** | Frankfurt | Render has no free background workers. The owner chose to pay rather than fold it into `stood-api` |
| Postgres | Neon | Free | AWS eu-central-1 (Frankfurt) | **Direct (unpooled) URL**, because Stood uses `LISTEN` |
| PayPal | Developer Dashboard, sandbox app (type **Merchant**) | Sandbox | — | US sandbox business account for the app; US personal account as the test buyer |
| Blueprint | Render Blueprint from `render.yaml` on `main` | — | — | Syncs automatically when `main` changes. Services have `autoDeploy: false`; deploys are triggered on purpose |

Yard is not deployed yet. Its credentialed composition root is batch C2 in issue #50.

## 2. Where the secrets live

| Store | Holds | Who can read it |
|---|---|---|
| Project `.env` (repository root, gitignored, mode 600) | All local values | The owner. Never committed |
| `~/.config/stood/.env` (mode 600) | A copy of the project `.env`, outside every repository | The owner and local tooling |
| Render service environment | Each service's runtime values (table below) | Render and the owner |
| Project `.env` only (not on Render yet) | `GROK_PLANNER_API_KEY` for Yard's planner model (xAI). Checked with a free model listing (HTTP 200). The live adapter is T-0181 | The owner |
| `~/.claude/settings.json` | `PAYPAL_SANDBOX_ACCESS_TOKEN` for the PayPal AI Toolkit MCP server only ([T16](tech/T16-paypal-ai-toolkit.md)) | The developer's Claude Code |

Rules we followed: no value in Git, chat, issues or screenshots; tools report only "set" or "empty". Values containing `&` (such as database URLs) must be read with a parser, not `source`d by a shell.

### Variables on each Render service

| Variable | `stood-api` | `stood-reconciler` | Source |
|---|---|---|---|
| `APP_ENV`, `PAYPAL_BASE_URL` | ✓ | ✓ | Fixed in `render.yaml` |
| `PORT`, `DEMO_MODE`, `STOOD_PLATFORM_ID` | ✓ | — | Fixed in `render.yaml` |
| `PROVIDER_PAYPAL=live` | ✓ | ✓ | Set through the Render API |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | ✓ | ✓ | PayPal sandbox app |
| `DATABASE_URL` | ✓ | ✓ | Neon, direct URL |
| `STOOD_API_KEY`, `STOOD_HMAC_SECRET`, `STOOD_WEBHOOK_SECRET` | ✓ | — | Generated locally (256-bit random) |
| `RECONCILIATION_OWNER` | — | ✓ (`ma-za-kpe`) | A name, not a secret |
| `PAYPAL_WEBHOOK_ID` | empty | — | Waits for the webhook (section 6) |

## 3. PayPal sandbox app

1. developer.paypal.com → **Sandbox → Accounts**: create a **Business** account and a **Personal** account, both in the **United States**. A Ugandan business account was available but not used: some capabilities (Vault, receiving) depend on country, and Stood's flows are in USD.
2. **Apps & Credentials → Create App**, type **Merchant**. Stood authorises on dispatch and captures on proof inside one merchant app. **Platform** is PayPal's marketplace product: it needs seller onboarding, and its delayed disbursement auto-releases after 28 days.
3. Features Stood uses: **Save payment methods (Vault)**, **Transaction search**, **Customer disputes**, **JavaScript SDK v6**. Orders, authorize and capture are on for every app. Payouts, Invoicing, Subscriptions, Payment links, Log in with PayPal and Mobile SDKs are not used. At the time of writing every feature was still ticked (the token included `payments/payouts`); untick the unused ones to narrow what any token from this app can do.
4. Copy the client ID and secret into `.env` as `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`.
5. Check without printing anything: a client-credentials call to `https://api-m.sandbox.paypal.com/v1/oauth2/token` returned HTTP 200, a 9-hour token, and scopes for authorize/capture, Vault payment tokens, Transaction Search and disputes.

## 4. Neon Postgres

1. Create the project in **AWS Europe Central 1 (Frankfurt)**. The first project was created in us-east-2 (Ohio). Every query from Frankfurt would have crossed the Atlantic, and Render cannot move an existing service's region ("changing region not supported"), so we made a new Neon project instead.
2. **Connect → connection pooling off**, and copy the direct URL into `DATABASE_URL`. The pooled host contains `-pooler` and does not support `LISTEN`.
3. Check: `psql "$DATABASE_URL" -c "listen probe; select 1"` succeeds.
4. **Apply the schema**: `docker compose run --rm -e DATABASE_URL app pnpm db:migrate`. This created 14 tables. The deployed server does **not** run migrations when it starts, so every new migration must be applied this way before its release, until a pre-deploy migration step exists.

We skipped Neon's quick-start (Neon CLI, MCP server, Neon Functions, buckets and Auth): Stood needs only the connection string.

## 5. Render

1. Add a **payment method** to the workspace (Workspace Settings → Billing). Without it the Blueprint refuses the Starter worker with `need_payment_info`.
2. **New → Blueprint**, repository `ma-za-kpe/stood`, branch **`main`**. `render.yaml` must already be on `main`.
3. Create a **Render API key** (Account Settings → API Keys) and store it as `RENDER_API_KEY` in `.env`. The Render CLI cannot set environment variables; the API can: `PUT https://api.render.com/v1/services/{serviceId}/env-vars/{KEY}` with `{"value": "…"}`.
4. Install the CLI from a folder outside `~/Documents`: `cd ~ && brew install render && render login && render workspace set`. Useful commands:
   - `render blueprints validate render.yaml` (also reports billing problems)
   - `render services -o json`, `render deploys list <serviceId>`, `render deploys create <serviceId> --confirm`
   - `render logs --resources <serviceId> --limit 200 -o text`
5. Deploy both services with `render deploys create`. The image build runs the full product gate (`pnpm validate`: lint, types, boundaries, all tests with coverage, build), so a failing test blocks the image.

## 6. PayPal webhook (after the first successful deploy)

Add one webhook in the sandbox app:

- URL: `https://stood-api.onrender.com/v1/webhooks/paypal`
- Events: `CHECKOUT.ORDER.APPROVED`, `PAYMENT.AUTHORIZATION.CREATED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.AUTHORIZATION.VOIDED` (the four Stood handles, not "all events")
- Put the webhook ID in `.env` and on `stood-api` as `PAYPAL_WEBHOOK_ID`, then redeploy.

## 7. Developer tooling

| Tool | Use | Record |
|---|---|---|
| PayPal AI Toolkit (`/plugin install paypal@claude-plugins-official`) | Best-practices skill, `/paypal:*` commands, sandbox MCP server as a read-only second witness | [T16](tech/T16-paypal-ai-toolkit.md), T-0246 |
| APIMatic PayPal Context Plugin (`npx context-plugins install https://github.com/paypaldev/server-sdk-context-plugin-preview`) | Grounds agent-written code in the PayPal Server SDK we already pin (`@paypal/paypal-server-sdk` 2.5.0: Orders, Payments, Vault, Transaction Search) | Planned: move the T-0155 Transaction Search reader onto the SDK's `TransactionSearchController` |
| Render CLI | Deploys, logs, Blueprint validation | Section 5 |
| GitHub CLI | Pull requests and issues. If the active `gh` account is not `ma-za-kpe`, use `GH_TOKEN=$(gh auth token --user ma-za-kpe)` per command instead of switching globally | — |

## 8. What went wrong, and the fixes

| Problem | Cause | Fix |
|---|---|---|
| "Blueprint file render.yaml not found on main" | `render.yaml` existed only on develop | Promoted develop to `main` (#57) |
| Blueprint created `stood-api` only | Render has no free background workers, and the workspace had no card | Reconciler set to `plan: starter` (#60); owner added a card |
| First image build failed: release test | The test asked pnpm for its default store; the image installed into `/workspace/.pnpm-store` | One store for the whole build stage via `npm_config_store_dir` (#60) |
| First image build failed: SDK timeout test | The fake transport missed an abort that fired before it ran, on a slow builder | The fake checks `signal.aborted` first (#60) |
| Every promotion to `main` conflicted | #57 was **squash**-merged, so `main` and develop shared no history | History-only back-merge with the `ours` strategy and no file changes (#62). Promotions to `main` use **merge commit** |
| Second image build failed: two Yard HTTP tests timed out | Render's builder is slower than CI and built both services at once | The image build sets `STOOD_TEST_TIMEOUT_MS=30000`; CI keeps 5 s (#64) |
| Pooled database URL | Neon's default connection string uses the pooler | Switched to the direct URL |
| Database in Ohio, services in Frankfurt | Neon project created in us-east-2 | New Neon project in eu-central-1, migrated again |
| Claude could not read `~/Documents`; `brew install` failed with `getcwd` | macOS privacy (Files and Folders) blocked the terminal app | Granted Documents access; ran installs from `~` |

## 9. Repeating this from scratch

1. PayPal sandbox app (section 3) → `.env`.
2. Neon project in eu-central-1, direct URL → `.env`; run the migrations (section 4).
3. Generate `STOOD_API_KEY`, `STOOD_HMAC_SECRET` and `STOOD_WEBHOOK_SECRET` (`scripts/dev setup`, or 32 random bytes each) → `.env`.
4. Render: card, Blueprint from `main`, API key → `.env`; set each service's variables (section 2) through the API; deploy both.
5. Check `https://stood-api.onrender.com/health`, then add the PayPal webhook (section 6) and redeploy.
6. Mint the MCP token for the PayPal AI Toolkit and run `/paypal:setup` ([T16](tech/T16-paypal-ai-toolkit.md)).
