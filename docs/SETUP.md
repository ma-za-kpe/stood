# How Stood is set up (sandbox)

This is the record of the hosted sandbox setup done on 7–8 October 2026: every account, service, variable name and decision, and how to repeat it. It names **where** each value lives, never the value. For the full key inventory and the tests that wait on keys, see [`HANDOFF.md`](HANDOFF.md). For the target architecture, see [T10](tech/T10-deployment.md). Keep this page current: every change to hosting, keys or accounts updates it in the same PR.

**Sandbox only.** No live PayPal app exists. `PROVIDER_PAYPAL=live` means "talk to the real PayPal **sandbox**", never real money.

## 1. What runs where

| Piece | Where | Plan | Region | Notes |
|---|---|---|---|---|
| `stood-api` | Render web service (Docker, `Dockerfile` target `api`) | Free | Frankfurt | `https://stood-api.onrender.com`, health at `/health`. Sleeps after about 15 minutes idle |
| `stood-reconciler` | Render background worker (same image, `dist/reconcile-cli.js`) | **Starter (paid, about $7/month)** | Frankfurt | Render has no free background workers. The owner chose to pay rather than fold it into `stood-api` |
| Postgres | Neon | Free | AWS eu-central-1 (Frankfurt) | **Direct (unpooled) URL**, because Stood uses `LISTEN` |
| PayPal | Developer Dashboard, sandbox app `stood-merchant-app` (type **Merchant**) | Sandbox | — | Owned by a US sandbox business account; a US personal account is the test buyer. Step-by-step: [the PayPal sandbox guide](guides/paypal-sandbox-authorize-capture-void.md) |
| Blueprint | Render Blueprint from `render.yaml` on `main` | — | — | Syncs automatically when `main` changes. Services have `autoDeploy: false`; deploys are triggered on purpose |

Yard is not deployed yet. Its credentialed composition root is batch C2 in issue #50.

## 2. Where the secrets live

| Store | Holds | Who can read it |
|---|---|---|
| Project `.env` (repository root, gitignored, mode 600) | All local values | The owner. Never committed |
| `~/.config/stood/.env` (mode 600) | A copy of the project `.env`, outside every repository | The owner and local tooling |
| Render service environment | Each service's runtime values (table below) | Render and the owner |
| Project `.env` only (not on Render yet) | `GROK_PLANNER_API_KEY` for Yard's planner model (xAI). Checked with a free model listing (HTTP 200). The live adapter is T-0181 | The owner |
| `~/.config/stood/yard-github-app.pem` (mode 600) | The Yard GitHub App private key; `.env` holds `GITHUB_APP_ID` and the key's path. The app is installable only on the owner's account, on selected test repositories, with Contents and Pull requests read/write and Metadata read; its webhook stays off until Yard is deployed | The owner |
| `~/.claude/settings.json` (mode 600) | `PAYPAL_SANDBOX_ACCESS_TOKEN` for the PayPal AI Toolkit MCP server only ([T16](tech/T16-paypal-ai-toolkit.md)), renewed automatically by the token refresher (section 8) | The developer's Claude Code |

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
| `PAYPAL_WEBHOOK_ID` | ✓ | — | The sandbox app's webhook (section 6), set 2026-10-08 |

## 3. PayPal sandbox app

1. developer.paypal.com → **Sandbox → Accounts**: create a **Business** account and a **Personal** account, both in the **United States**. A Ugandan business account was available but not used: some capabilities (Vault, receiving) depend on country, and Stood's flows are in USD.
2. **Apps & Credentials → Create App**, type **Merchant**. Stood authorises on dispatch and captures on proof inside one merchant app. **Platform** is PayPal's marketplace product: it needs seller onboarding, and its delayed disbursement auto-releases after 28 days.
3. Features Stood uses: **Save payment methods (Vault)**, **Transaction search**, **Customer disputes**, **JavaScript SDK v6**. Orders, authorize and capture are on for every app. Payouts, Invoicing, Subscriptions, Payment links, Log in with PayPal and Mobile SDKs are not used. Every feature is deliberately left ticked until the project is finished (owner decision, 2026-10-08), so the token includes scopes Stood does not use, such as `payments/payouts`. Stood's code calls only the APIs above, and the MCP server is used read-only (T16).
4. Copy the client ID and secret into `.env` as `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`.
5. Check without printing anything: a client-credentials call to `https://api-m.sandbox.paypal.com/v1/oauth2/token` returned HTTP 200, a 9-hour token, and scopes for authorize/capture, Vault payment tokens, Transaction Search and disputes.

### Sandbox accounts for real runs

`scripts/dev sandbox-run release|refuse` (T-0224) needs two **United States** sandbox accounts besides the app owner:

- **Business (merchant)**, the payee. Its public **Account ID** goes in `.env` as `STOOD_SANDBOX_PAYEE_ID`. The app's own business account was Ugandan, and PayPal refused it as payee with `PAYEE_ACCOUNT_LOCKED_OR_CLOSED` (Uganda's accounts are send-only). Naming a US business account as payee lets the app **capture** (the release run succeeded on 2026-10-08) but **not void**: PayPal answered the refuse run's void with HTTP 403, because only the payee's own app may void its holds. So the sandbox app must be **owned by the US business account**; a third-party payee is not a full workaround. Done on 2026-10-08: the app `stood-merchant-app` (app id `APP-92D42792B8255350D`) is owned by the US business account `NSBFV7E76WDQL`; with it the release run captured and the refuse run voided. The first app's values are kept in `.env` as `RETIRED_UG_APP_PAYPAL_*`, unused. Its webhook was narrowed from all events to the four Stood handles.
- **Personal (buyer)**, who approves. A new personal account may have no payment method; add a generated sandbox test card (Sandbox → Card testing), kept in `.env` as `PAYPAL_SANDBOX_TEST_CARD_*`.

PayPal's checkout error pages carry a base64 `code=` parameter: `PAYEE_ACCOUNT_LOCKED_OR_CLOSED` (payee cannot receive) and `PAYMENT_ALREADY_DONE` (the link was opened again after approval) are the two we met.

## 4. Neon Postgres

1. Create the project in **AWS Europe Central 1 (Frankfurt)**. The first project was created in us-east-2 (Ohio). Every query from Frankfurt would have crossed the Atlantic, and Render cannot move an existing service's region ("changing region not supported"), so we made a new Neon project instead.
2. **Connect → connection pooling off**, and copy the direct URL into `DATABASE_URL`. The pooled host contains `-pooler` and does not support `LISTEN`.
3. Check: `psql "$DATABASE_URL" -c "listen probe; select 1"` succeeds.
4. **Apply the schema**: from release T-0253 on, `stood-reconciler`'s Render pre-deploy command (`/nodejs/bin/node dist/migrate-cli.js`) applies pending migrations before each release goes live, and a failed migration stops the deploy. Deploy the reconciler first, then `stood-api`. For a brand-new database before the first deploy, or to run it by hand: `docker compose run --rm -e DATABASE_URL app pnpm db:migrate` (the same `drizzle.__drizzle_migrations` record, so both ways agree).

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

What `stood-api` does with each delivery (T-0033): it asks PayPal's `verify-webhook-signature` API whether PayPal really sent it (OAuth token cached, sandbox host only), refuses deliveries with missing transmission headers or a certificate URL outside `paypal.com`, stores each verified event once in the `provider_events` table (migration 0017), and answers `202`. If PayPal's verification API is down it answers `503`, so PayPal retries. An event is only a hint: the reconciler still reads provider proof before any money state changes. The receiver is off unless `PROVIDER_PAYPAL=live`, `DATABASE_URL` and all three PayPal values are set.

### Nightly sandbox run (T-0234)

`.github/workflows/sandbox-nightly.yml` runs every night at 03:17 UTC (and on demand): a hold from the saved test buyer is released (captured) and another refused (voided), with no human approval, then `tools/sandbox-nightly/verify.py` checks the outcomes and confirms them with the independent witness. Recordings are kept as a 30-day artifact, never committed. Nothing is left open. It needs four **GitHub Actions secrets**, sandbox values only: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `STOOD_SANDBOX_PAYEE_ID` and `PAYPAL_SANDBOX_VAULT_TOKEN_ID` (from `scripts/dev sandbox-run vault-setup`). Until they exist the job skips with a notice.

## 7. Yard GitHub App

Yard reads and writes the buyer's repository through a GitHub App, never a personal token. Public page: <https://github.com/apps/yard-builder>.

1. github.com → Settings → Developer settings → **GitHub Apps → New GitHub App**:
   - Name `Yard Builder`, homepage `https://ma-za-kpe.github.io/stood/yard/`.
   - Redirect URI, OAuth during installation, Device Flow and Setup URL: **all empty or off**. Yard uses installation tokens, not user sign-in.
   - Webhook **Active: off** until Yard is deployed (then URL plus `GITHUB_APP_WEBHOOK_SECRET`).
   - Repository permissions: **Contents read/write, Pull requests read/write, Metadata read**. Nothing else; no organisation, account or enterprise permissions; no events.
   - Installable **only on this account**. Making it public is a later decision (buyers connecting their own repositories).
2. Note the **App ID** → `GITHUB_APP_ID` in `.env`.
3. **Generate a private key**, then move it out of Downloads: `mv ~/Downloads/*.private-key.pem ~/.config/stood/yard-github-app.pem && chmod 600 ~/.config/stood/yard-github-app.pem`. `GITHUB_APP_PRIVATE_KEY_PATH` points to it. Downloads are readable by every user on the machine.
4. **Install App → Only select repositories** → [`ma-za-kpe/yard-sandbox`](https://github.com/ma-za-kpe/yard-sandbox), a public throwaway repository whose README explains why it exists. Never `stood` itself. The first install accidentally chose **All repositories**, which gave write access to every repository on the account; check the selection after installing.
5. Check without printing secrets: sign a 9-minute JWT with the private key (`iss` = App ID, RS256), call `GET /app` (expect slug `yard-builder` and exactly the three permissions), then `POST /app/installations/{id}/access_tokens` and `GET /installation/repositories` (expect only the test repository). The installation token expires within an hour and is never stored.

The live adapter that uses the app (one-repository tokens, `wo/*` branches, pull requests and attack cases) is T-0188 in batch C3.

## 8. Developer tooling

| Tool | Use | Record |
|---|---|---|
| PayPal AI Toolkit (`/plugin install paypal@claude-plugins-official`) | Best-practices skill, `/paypal:*` commands, sandbox MCP server as a read-only second witness | [T16](tech/T16-paypal-ai-toolkit.md), T-0246 |
| PayPal MCP token refresher ([`tools/paypal-mcp-token`](../tools/paypal-mcp-token/README.md)) | Mints the sandbox token into `~/.claude/settings.json` at login, 07:00 daily and every 8 hours (macOS LaunchAgent `com.stood.paypal-mcp-token`); never prints it | Installed 2026-10-08 |
| APIMatic PayPal Context Plugin (`npx context-plugins install https://github.com/paypaldev/server-sdk-context-plugin-preview`) | Grounds agent-written code in the PayPal Server SDK we already pin (`@paypal/paypal-server-sdk` 2.5.0: Orders, Payments, Vault, Transaction Search). Installed 2026-10-08 into Claude Code, VS Code and Codex as `paypal@context-plugins-local` | Used for T-0155 (Transaction Search through the SDK); recorded in [T16](tech/T16-paypal-ai-toolkit.md#apimatic-paypal-context-plugin) |
| Render CLI | Deploys, logs, Blueprint validation | Section 5 |
| GitHub CLI | Pull requests and issues. If the active `gh` account is not `ma-za-kpe`, use `GH_TOKEN=$(gh auth token --user ma-za-kpe)` per command instead of switching globally | — |

## 9. What went wrong, and the fixes

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
| GitHub App installed on **all** repositories | "All repositories" was chosen at install time | Narrowed to `yard-sandbox`; the check in section 7 confirmed exactly one reachable repository |
| `stood-reconciler` exited with status 128 at start | Render's `dockerCommand` replaces the image ENTRYPOINT, so it tried to execute the `.js` file directly | `dockerCommand: /nodejs/bin/node dist/reconcile-cli.js` (#67) |
| GitHub App private key in `~/Downloads` | Browsers save there readable by every user | Moved to `~/.config/stood/` with mode 600 |
| Claude could not read `~/Documents`; `brew install` failed with `getcwd` | macOS privacy (Files and Folders) blocked the terminal app | Granted Documents access; ran installs from `~` |

## 10. Repeating this from scratch

1. PayPal sandbox app (section 3) → `.env`.
2. Neon project in eu-central-1, direct URL → `.env`; run the migrations (section 4).
3. Generate `STOOD_API_KEY`, `STOOD_HMAC_SECRET` and `STOOD_WEBHOOK_SECRET` (`scripts/dev setup`, or 32 random bytes each) → `.env`.
4. Render: card, Blueprint from `main`, API key → `.env`; set each service's variables (section 2) through the API; deploy both.
5. Check `https://stood-api.onrender.com/health`, then add the PayPal webhook (section 6) and redeploy.
6. GitHub App (section 7): create, key to `~/.config/stood/`, install on one test repository, check.
7. Mint the MCP token for the PayPal AI Toolkit and run `/paypal:setup` ([T16](tech/T16-paypal-ai-toolkit.md)).
