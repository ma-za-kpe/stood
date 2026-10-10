# How Stood is set up (sandbox)

This is the record of the hosted sandbox setup done on 7–8 October 2026: every account, service, variable name and decision, and how to repeat it. It names **where** each value lives, never the value. For the full key inventory and the tests that wait on keys, see [`HANDOFF.md`](HANDOFF.md). For the target architecture, see [T10](tech/T10-deployment.md). Keep this page current: every change to hosting, keys or accounts updates it in the same PR.

**Sandbox only.** No live PayPal app exists. `PROVIDER_PAYPAL=live` means "talk to the real PayPal **sandbox**", never real money.

## 1. What runs where

| Piece | Where | Plan | Region | Notes |
|---|---|---|---|---|
| `stood-api` | Render web service (Docker, `Dockerfile` target `api`) | Free | Frankfurt | `https://stood-api.onrender.com`, health at `/health`. Sleeps after about 15 minutes idle |
| `stood-reconciler` | Render background worker (same image, `dist/reconcile-cli.js`) | **Starter (paid, about $7/month)** | Frankfurt | Render has no free background workers. The owner chose to pay rather than fold it into `stood-api` |
| `stood-yard-api` | Render web service (Docker, `services/yard-api/Dockerfile`) | **Starter (paid, about $7/month)** | Frankfurt | `https://stood-yard-api.onrender.com/health`. Always on for lease-expiry and log-retention jobs. Owner's choice (2026-10-08). The Yard web app is served by this image at `/app/`; sign-in uses an owner-issued operator access code |
| Postgres | Neon | Free | AWS eu-central-1 (Frankfurt) | **Direct (unpooled) URL**, because Stood uses `LISTEN` |
| PayPal | Developer Dashboard, sandbox app `stood-merchant-app` (type **Merchant**) | Sandbox | — | Owned by a US sandbox business account; a US personal account is the test buyer. Step-by-step: [the PayPal sandbox guide](guides/paypal-sandbox-authorize-capture-void.md) |
| Blueprint | Render Blueprint from `render.yaml` on `main` | — | — | Syncs automatically when `main` changes. Services deploy `main` automatically once its GitHub checks pass (T-0256) |

### Yard on Render (T-0214, T-0220)

Yard shares Stood's Neon database through **its own roles**: `yard_owner` (no login; owns the `yard` schema) and `yard_runtime` (login; can read and write only Yard's tables, never Stood's). Run once:

```bash
scripts/dev yard-setup   # creates both roles, applies Yard's schema, writes the Yard settings into .env (never printed)
```

It writes `YARD_DATABASE_URL` (the restricted runtime URL), `YARD_MIGRATION_DATABASE_URL` (the owner URL, used only by the pre-deploy step), `YARD_SECRET_KEYS` and `YARD_OPERATORS` (the signed API clients). Copy all four to the `stood-yard-api` service on Render. Each release, Render's pre-deploy runs `db-cli.js migrate` before the new version goes live. `/health` says what is on: the Board, site log and events now; private intake is connected independently; the Foreman waits for its hosted adapter, and Yard payments wait for the Stood connection. Anything missing is a named line in the service log, never a crash.

### Hosted Yard sign-in and research import

The same Yard service serves `/app/` and `/app/api/*`; no additional web service or account is needed. `YARD_WEB_DIR=/app/web` is baked into its image, and `YARD_PUBLIC_ORIGIN` defaults to `https://stood-yard-api.onrender.com`. Operator signing secrets stay on the server.

Run `scripts/dev yard-access-codes` once to add an unpredictable `accessCode` to each operator in the private `.env`. It writes the role-to-code list to `~/.config/stood/yard-access-codes` with mode 600 and prints only the path. Copy the updated **YARD_OPERATORS** value to the Yard service through the Render API, then deploy. Share each code privately with that operator; never put codes in an issue, a Discord post or a screenshot.

Sessions use opaque Secure/HttpOnly/SameSite=Strict cookies and expire after eight hours. Sign-out removes the server session and private browser queries. Sessions live in this single service instance; a restart signs everyone out. Access-code guessing is limited; mutations require the configured page origin. Rotation replaces the code in YARD_OPERATORS and deploys, revoking the old code and sessions.

Buyer sign-in opens the start screen with automatically loaded clickable research cards and a separate own-project option. Cards open focused review and can start a private summary brief. Full Startup Tribunal Copy JSON import is a secondary disclosure; known private metadata is stripped automatically with a notice, and source caveats/scores are preserved. Saved links open a brief overview; editing returns to the saved section. The public discovery feed is read from one fixed HTTPS endpoint, bounded to ten items/64 KiB and cached for ten minutes; rate-limit responses delay retries. Imported blueprints are bounded to 128 KiB and twenty levels, scanned with the existing credential guard, and never rendered as HTML or executed. Only a reviewed, bounded excerpt becomes intake; the full raw research stays in memory and is discarded when the panel closes. Planning remains disabled until the hosted Foreman is connected.

### Deployed C2 entry points and evidence

- [Hosted Yard](https://stood-yard-api.onrender.com/app/): owner-issued sign-in, Board, events, site log and private intake with StartupTribunal browse/import. [Yard health](https://stood-yard-api.onrender.com/health) reports intake on; Foreman and Yard payments remain off.
- [Stood health](https://stood-api.onrender.com/health): earned `paymentReady` for saved-account signing and milestone funding on the real PayPal sandbox. No real money moves.
- [Stood website](https://ma-za-kpe.github.io/stood/) and [Yard companion site](https://ma-za-kpe.github.io/stood/yard/): public status comes from those health checks; Yard links to the hosted app.
- Shipped through [#104](https://github.com/ma-za-kpe/stood/pull/104) and [#105](https://github.com/ma-za-kpe/stood/pull/105); the [progress post (#108)](https://github.com/ma-za-kpe/stood/issues/108) includes actual desktop/mobile checks and screenshot instructions. [#99](https://github.com/ma-za-kpe/stood/issues/99) tracks copied-report sanitization after the initial import deployment. Hosted planning continues in [#76](https://github.com/ma-za-kpe/stood/issues/76); UX and 98% app coverage remain on [#75](https://github.com/ma-za-kpe/stood/issues/75).

## 2. Where the secrets live

| Store | Holds | Who can read it |
|---|---|---|
| Project `.env` (repository root, gitignored, mode 600) | All local values | The owner. Never committed |
| `~/.config/stood/.env` (mode 600) | A copy of the project `.env`, outside every repository | The owner and local tooling |
| Render service environment | Each service's runtime values (table below) | Render and the owner |
| Project `.env` only (not on Render yet) | `GROK_PLANNER_API_KEY` for Yard's planner model (xAI). Checked with a free model listing (HTTP 200). The live adapter is T-0181 | The owner |
| `~/.config/stood/yard-github-app.pem` (mode 600) | The Yard GitHub App private key; `.env` holds `GITHUB_APP_ID` and the key's path. The app is installable only on the owner's account, on selected test repositories, with Contents and Pull requests read/write and Metadata read; its webhook stays off until Yard is deployed | The owner |
| Project `.env` only | `APIMATIC_API_KEY`: regenerates the TypeScript SDK with `scripts/dev sdk` (T-0053). From the APIMatic dashboard → Account → API Keys. Only the person regenerating needs it; CI builds and tests the committed SDK without it | The owner |
| Project `.env` only | `GITGUARDIAN_API_KEY`: a GitGuardian personal access token with the `scan` scope, for the `ggshield` pre-push hook (T-0287). Get it at [dashboard.gitguardian.com](https://dashboard.gitguardian.com) → API → Personal access tokens. Every push fails without it | The owner |
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
2. **Connect → connection pooling off**, and copy the direct URL into `DATABASE_URL`. The pooled host contains `-pooler` and does not support `LISTEN`. Change `sslmode=require` to **`sslmode=verify-full`**, so the client checks Neon's certificate and hostname (the Postgres client warns that `require` will change meaning). Outside `local` and `ci`, Stood refuses a URL without `verify-full` or with the pooled host (T-0254): the CLIs stop with a named reason, and the API stays up without database features.

   Render applies a changed environment variable on the next **deploy**, not on a restart.
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

### Keep-warm (T-0089)

`.github/workflows/keep-warm.yml` calls `/health` every 10 minutes so the free `stood-api` rarely sleeps. GitHub runs schedules on a best-effort basis, so a cold start (about a minute) is still possible; the API's first answer after sleep is slow, not wrong.

### Nightly sandbox run (T-0234)

`.github/workflows/sandbox-nightly.yml` runs every night at 03:17 UTC (and on demand): a hold from the saved test buyer is released (captured) and another refused (voided), with no human approval, then `tools/sandbox-nightly/verify.py` checks the outcomes and confirms them with the independent witness. Recordings are kept as a 30-day artifact, never committed. Nothing is left open. It needs four **GitHub Actions secrets**, sandbox values only: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `STOOD_SANDBOX_PAYEE_ID` and `PAYPAL_SANDBOX_VAULT_TOKEN_ID` (from `scripts/dev sandbox-run vault-setup`). Until they exist the job skips with a notice.

### Reconciliation findings (T-0155, T-0257)

Every hour `stood-reconciler` compares the last 30 days of PayPal payment captures (Transaction Search, settled for 3 hours) with Stood's ledger and records each mismatch in `reconciliation_findings` (migrations 0018 and 0019). Its log says `Audit: N captures checked, M findings open.` A finding the audit no longer sees closes itself. One that is explained (for example a capture made by an operator tool, outside Stood) is closed by a person, with a name and a reason, and stays closed:

```bash
scripts/dev findings list
scripts/dev findings resolve finding_… --by "<your name>" --note "<why this is not a problem>"
```

Only `DATABASE_URL` from `.env` reaches the container, and the connection must pass the same TLS policy as production.

**Alerts (T-0155).** `GET https://stood-api.onrender.com/ops/attention` answers with counts only (`needsPerson`, `openFindings`, `openAlerts`, `oldestOpenedAt`), never ids or amounts. The keep-warm job reads it every 10 minutes: while anything is open it keeps one GitHub issue labelled `ops-attention` open (watch the repository to get it by email), and closes that issue once nothing is. No extra secret and no extra workflow: the job already runs, and uses the repository's own token.

**Test runs are not findings (T-0259).** `scripts/dev sandbox-run` and the nightly job capture real sandbox money outside Stood's ledger on purpose. Their PayPal `invoice_id` is `sandbox-<scenario>-<time>-settle`; the audit sets exactly those aside. Stood's own operation keys always contain `:`, so a real payment can never be mistaken for a test run.

### Signing and funding, and when payments turn on (T-0260, T-0261)

A platform asks Stood to sign a saved-PayPal mandate (`POST /v1/allowances/{id}/mandate`) and later to fund a tranche (`POST /v1/tranches/{id}/funding`). These routes only record the request. `stood-reconciler` makes every PayPal call on its next tick (every 15 seconds): it creates the setup token, waits for the buyer to approve saving PayPal once, saves the token sealed, then places later holds with no buyer present. Read progress with the matching `GET` routes; they show status, the approval link and the hold's expiry, never tokens or PayPal ids.

`/health` reports `"paymentReady": true` only when all three hold: every payment key is set, the real PayPal sandbox (not the simulator) is connected and ready, and signing is wired (`VAULT_TOKEN_KEYS` set on both Stood services). Otherwise its `sentence` names what is missing. The public pages read this and say "sandbox payments on" or what is off. It is always the PayPal **sandbox**: no real money.

### Saved PayPal tokens are sealed (T-0227)

A saved PayPal token is a standing permission to charge the buyer, so Stood never stores it in plain text. `mandate_signatures.token_id` holds it sealed with AES-256-GCM, bound to its own mandate row (migration 0021), and the append-only history only ever sees the sealed value. A SHA-256 fingerprint keeps one token to one mandate. Keys live in `VAULT_TOKEN_KEYS` (`v2:<key>,v1:<key>`, newest first; every listed key can open, only the newest seals):

```bash
scripts/dev vault-key      # add a new newest key to .env (never printed)
scripts/dev vault-rotate   # re-seal every saved token under it
```

Then copy `VAULT_TOKEN_KEYS` to Render, and drop the old key only after rotation reports it re-sealed everything. A store missing a key fails closed: it refuses to open the token rather than guess.

### The Foreman's live planner (T-0221)

The Foreman drafts blueprints with xAI's Grok through `GrokPlannerModel`. It uses the cheapest listed model (`grok-build-0.1`, $1.00 per million input tokens and $2.00 per million output tokens on 2026-10-09) unless `GROK_PLANNER_MODEL` says otherwise, makes one call per draft with at most 4,000 output tokens, and never retries blindly. A daily spend guard (`GROK_DAILY_BUDGET_USD`) reserves the worst case before each call; when the day's budget is used, planning pauses until the next UTC day. Each call logs only the model, token counts and cost. The model proposes the work; budgets and deadlines are always computed from the buyer's fixed terms.

```bash
scripts/dev planner-check   # five live drafts against the shared contract; about $0.01 in total
```

**Hosted (T-0181).** `stood-yard-api` turns the Foreman on only when all of these are set. `render.yaml` commits the public ones; Render prompts for the two secrets, `GROK_PLANNER_API_KEY` and `GITHUB_APP_PRIVATE_KEY_BASE64`. Otherwise `/health` reports `foreman: false` and the log names what is missing (never a value):

| Variable | Value |
| --- | --- |
| `GROK_PLANNER_API_KEY` | the xAI key |
| `GROK_DAILY_BUDGET_USD` | daily cap, $0.01 to $5; empty means $0.50 |
| `GROK_PLANNER_MODEL` | optional; empty means `grok-build-0.1` |
| `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID` | from the Yard Builder App |
| `GITHUB_APP_PRIVATE_KEY_BASE64` | `base64 < key.pem \| tr -d '\n'` |
| `YARD_SANDBOX_REPOSITORY` | the one repository Yard plans against, `owner/name` |

The spend cap is kept in Postgres (`yard.planner_spend`), so restarts and extra instances share one daily budget. Plans are pinned to the repository's real `main` through a read-only token. The pre-deploy migration also creates the Foreman's checkpoint tables.

### Code runner and settlement (T-0159, T-0164, ADR-0026)

`stood-reconciler` decides code milestones itself. Every minute it takes the latest undecided package of each held code tranche and runs the buyer's frozen tests, read at the signed base commit and checked against the signed bundle hash, on the builder's exact commit in a disposable [Vercel Sandbox](https://vercel.com/docs/vercel-sandbox) microVM: no credentials inside, only the npm registry while dependencies install, no network at all while the tests run. The worker signs the result with its own Ed25519 key outside the VM, verifies it like any report, merges the read-only repository checks, and records one decision on the tranche.

Settlement is a separate switch. With `SETTLEMENT_EXECUTOR=on`, the reconciler then captures a released tranche or voids a refused one on the PayPal sandbox. Leave it unset and decisions are recorded but no money moves.

| Variable | On `stood-reconciler` |
| --- | --- |
| `VERCEL_TOKEN` | A token scoped to the runner's team (prompted) |
| `VERCEL_TEAM_ID`, `VERCEL_PROJECT_ID` | Committed in `render.yaml` (the `stood-runner` project) |
| `RUNNER_KEY_ID`, `RUNNER_SIGNING_KEY` | From `scripts/dev runner-key`, which writes them to `.env` without printing; copy both to Render |
| `STOOD_EVIDENCE_S3_ENDPOINT`, `STOOD_EVIDENCE_S3_ACCESS_KEY_ID`, `STOOD_EVIDENCE_S3_SECRET_ACCESS_KEY` | Cloudflare R2: the account's S3 endpoint and a token scoped to the `stood-evidence` bucket only (set 2026-10-10). `STOOD_EVIDENCE_S3_BUCKET=stood-evidence` is committed in `render.yaml`. The runner stays off without all four |
| `GITHUB_READ_TOKEN` | Optional, read-only, for private repositories |
| `SETTLEMENT_EXECUTOR` | `on` to capture or void decided tranches; anything else keeps settlement off |

```bash
scripts/dev runner-check   # qualify the runner on real Vercel Sandbox: pass, fail, no network, no credentials, non-root, runaway stopped
scripts/dev runner-key     # create the signing key (refuses to replace one; --rotate to replace)
scripts/dev evidence-check # qualify the evidence bucket: write once by hash, read back, retry is the same object
```

Baselines use the same runner: a platform asks `POST /v1/baselines` to run a milestone's frozen tests on the base commit before work is posted, and reads which failed with `GET /v1/baselines/{id}` (C4). Every signed run is stored in the evidence bucket before it can decide, at `runs/<platform>/<tranche>/<package>/<sha256>` (write-once: an object is never replaced). If the bucket cannot be reached, the package waits and nothing is decided.

Final milestones (`code.final@1`) also require the buyer's usage confirmation (`usage_release`). A platform forwards it to `POST /v1/tranches/{id}/usage` as a usage receipt: Ed25519-signed, bound to the allowance, the tranche and the latest package's commit, at most 24 hours old, and with a nonce used once. Stood accepts receipts only from keys listed in `USAGE_AUTHORITY_KEYS` on `stood-api` (`[{"keyId", "root", "publicKey": base64 of an Ed25519 SPKI PEM}]`). The runner then decides the waiting final milestone again, once, with usage confirmed (decision `usage:<package>`).

```bash
scripts/dev usage-key   # Yard's Ed25519 usage key into .env (not printed), plus the public USAGE_AUTHORITY_KEYS line
```

Set `YARD_USAGE_KEY_ID` and `YARD_USAGE_SIGNING_KEY` on `stood-yard-api`, and `USAGE_AUTHORITY_KEYS` on `stood-api`. In Yard's handover panel the buyer confirms use of a delivered final milestone; Yard forwards it within a minute and shows Stood's answer.

**Trust note.** The usage authority is the platform's own key (Yard's), not a key any builder holds. Yard signs only when the authenticated buyer who owns the blueprint confirms use, so Stood relies on the platform for who the buyer is, as it already does for the allowance itself. Stood does not know builder identities, so it cannot check the builder's tree itself.

### Yard reads Stood (T-0189)

Stood sends platforms no notifications, so `stood-yard-api` reads Stood's signed tranche view (`GET /v1/tranches/:id`) for every work order it waits on, once a minute, and applies only what that read shows: a hold for a claimed attempt, or a capture or refusal of the exact package it submitted. Set the platform's own credentials on `stood-yard-api` in Render, the same `STOOD_API_KEY` and `STOOD_HMAC_SECRET` that `stood-api` holds; `STOOD_API_URL` is committed as `https://stood-api.onrender.com`. With them, Yard creates allowance drafts through Stood and `/health` reports `payments: true`. Stood only ever talks to the PayPal sandbox, and Yard refuses any other provider.

Hosted Yard submits packages to Stood (`StoodPackageGateway`). Stood never trusts a platform's test report: its own runner runs the buyer's frozen tests on the exact commit (T-0159). Yard sends the digest of its submission manifest (tranche, repository, base commit, commit) as `report_sha256`, for traceability only.

### Yard previews on Render (T-0196)

A buyer can preview a submitted milestone: Yard runs the exact image, pinned by digest, as a free-plan Render web service with only the buyer's TEST/DEV keys (each decrypted for that deploy and audited) and `YARD_PREVIEW=simulated-test-data`. Previews expire after 30 days, or 7 after payment; an hourly sweep deletes them, and closing a project deletes the rest. Only the buyer can start one (`POST /yard/v1/blueprints/:id/work-orders/:wo/preview` with `{ "image": "...@sha256:..." }`), because the preview receives their keys; asking again returns the live preview.

Render has no spend cap, so Yard keeps its own: at most three live `yard-preview-*` services, free plan only, and it deletes nothing that is not a Yard preview. A Render API key reaches a whole workspace, so give hosted Yard a key from a **separate workspace** made for previews: set `RENDER_PREVIEW_API_KEY` and `RENDER_PREVIEW_OWNER_ID` (`tea-...`, from `GET /v1/owners`) on `stood-yard-api`. Without them, `/health` stays the same and the log says `Previews off`.

```bash
scripts/dev preview-check   # one free-plan preview from a digest-pinned public image; waits for https, deletes it, checks it is gone
```

### Unattended sandbox approval with Kernel (C3)

`scripts/dev sandbox-run release|refuse|vault-setup` needs a buyer to approve on PayPal's sandbox page. With `KERNEL_API_KEY` (from kernel.sh) and the sandbox personal account's `PAYPAL_SANDBOX_BUYER_EMAIL` and `PAYPAL_SANDBOX_BUYER_PASSWORD` in `.env`, a Kernel cloud browser signs in and approves instead, so every outcome replays with nobody at the keyboard. It opens nothing but `https://www.sandbox.paypal.com`, never prints the password, and always ends the cloud browser (which also stops on its own after five idle minutes). Without them, the run prints the link for a person, as before.

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

### What the App may do (T-0188)

Yard talks to GitHub only through the Yard Builder App (`GitHubRepositories`). GitHub limits each token to one repository and to the permission needed: reading, building on a branch, or maintaining `main`. On top of that, Yard refuses before any write: repositories outside `YARD_SANDBOX_REPOSITORY`, branches other than the work order's own `wo/*` branch, any change under `tests/` or `.github/`, and any move of `main` that is not a fast-forward to exactly the checked commit. Merges go through an open pull request. Qualify it on the sandbox repository (a throwaway branch; `main` is never touched):

```bash
scripts/dev github-check
```

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

Postman is deferred by the owner as of 2026-10-09. No upgrade or API key is needed for this phase or C2 closure. Existing Render health checks and GitHub Actions remain in use; see [the operational decision](tech/T10-deployment.md#postman-deferred).
