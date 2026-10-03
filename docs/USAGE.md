# Stood: usage manual

> **Money does not move until someone stood there.**
> An open-source release gate for staged payments, built on PayPal and AI.

| | |
|---|---|
| **Status** | ⚠️ **v1 draft contract, not yet implemented.** This manual describes the API being built for the PayPal AI Hackathon 2026. Every example uses the **PayPal sandbox**. Check the [changelog](https://ma-za-kpe.github.io/stood/changelog.html) for what has shipped |
| **Licence** | MIT |
| **Hosted demo** | `https://stood-api.onrender.com/v1` (sandbox, free tier: the first request after idle can take about 1 min) |
| **SDK (planned)** | `npm i @stood/sdk` (TypeScript, APIMatic-generated). Kotlin and Python later |
| **Spec** | `openapi/stood.yaml` (OpenAPI 3.1) |
| **Docs** | [Overview](09-stood.md) · [API spec](tech/T04-api-spec.md) · [Evidence profiles](stood/S16-use-cases-and-evidence-profiles.md) |

---

## What Stood does, in 20 seconds

You run a platform where someone pays for work in **stages**: a house build, a freelance milestone, an insurance repair, a grant tranche. Stood sits between "the stage is done" and "the money moves":

1. **Allowance:** the payer signs, once, what "done" means for each milestone (via PayPal).
2. **Hold:** when a milestone is ready, Stood asks PayPal to **authorise** (hold) the amount.
3. **Package:** you send the evidence: photos, files, recordings, coordinates.
4. **Decision:** Stood's rules return **`RELEASE`** (PayPal capture), **`REFUSE`** (PayPal void, plus the named reason), or **`WAIT`** (a human reviews).
5. **File:** every decision leaves a receipt and a dispute packet.

Stood **never holds money**, never pays anyone locally, and never knows your industry. You choose an **evidence profile** (`construction.stage@1`, `freelance.milestone@1`, …).

---

## For hackathon judges: try it in 2 minutes

**Current local implementation:** start `docker compose up -d api`. `POST http://localhost:3000/v1/demo/scenarios/wrong-plot` runs synthetic check results through the real rule and returns `payment.executed: false`. It does not authorise, capture or void. The hosted sandbox replay and SDK below are planned contracts, not shipped capabilities.

**Planned hosted demo (not yet implemented):** no account will be needed. These endpoints will run fixture scenarios against the PayPal **sandbox** and return real sandbox order, void and capture IDs. The hosted URL, sentences, `named_field`, `paypal` block, receipts, browser approval and Postman replay below are target contracts; they are not responses or capabilities of the current local API.

```bash
BASE=https://stood-api.onrender.com/v1

# 1. Wake the free-tier demo (first call can take ~1 minute)
curl -s $BASE/../health

# 2. Run a scenario: good | wrong-plot | recycled | wrong-stage | substituted-fitting | freelance-missing-screen
curl -s -X POST $BASE/demo/scenarios/wrong-plot | jq '{outcome, named_field, sentence, paypal}'
```

Planned response (not yet implemented):

```json
{ "outcome": "REFUSE", "named_field": "plot",
  "sentence": "Wrong plot. 1.4 km off. Nothing was paid.",
  "paypal": { "order_id": "…", "authorization_id": "…", "status": "VOIDED" } }
```

- Watch it in the browser: the landing page's "Try the gate" section, and the receipt link returned by each scenario.
- Replay as the payer (Kernel drives the PayPal sandbox approval live): `POST $BASE/demo/approve`. It returns a live-view URL.
- Postman: the public "Stood × PayPal" workspace has every scenario pre-built.

---

## Keys and configuration

### A. Calling Stood from your platform (hosted)

| Key | What it is | Where it comes from | Where it lives |
|---|---|---|---|
| `STOOD_API_KEY` | Bearer key identifying your platform | Issued per platform and environment by the Stood maintainer (during the hackathon: open an issue) | Your server's secret store (for example Google Secret Manager). **Never in a mobile app or browser** |
| `STOOD_HMAC_SECRET` | Signs every request you send (`Stood-Signature`) | Issued with the API key | Server secret store |
| `STOOD_WEBHOOK_SECRET` | Verifies the webhooks Stood sends you | Issued when you register a webhook URL | Server secret store |
| `STOOD_BASE_URL` | `https://stood-api.onrender.com/v1` (sandbox) | — | Config |

You **don't** give Stood your users' PayPal passwords or card details. Payers approve in PayPal's own window.

### B. Self-hosting Stood (Docker)

| Variable | Required | Notes |
|---|---|---|
| `APP_ENV` | ✓ | `local` / `ci` / `demo`. **There's no `live` until an ADR allows it** |
| `PAYPAL_BASE_URL` | ✓ | Must be `https://api-m.sandbox.paypal.com`. The app refuses to boot otherwise |
| `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` | ✓ | From a **sandbox** app at developer.paypal.com (merchant = the platform's business account) |
| `PAYPAL_WEBHOOK_ID` | ✓ | From the sandbox app's webhook settings (used to verify PayPal webhooks) |
| `DATABASE_URL` | ✓ | Postgres 17 (local: the `db` container. Demo: Neon) |
| `S3_ENDPOINT` / `S3_BUCKET` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | ✓ | Local: MinIO. Demo: Cloudflare R2 (a bucket-scoped token) |
| `RECEIPT_SIGNING_KEY` | ✓ | Random 32+ bytes. Signs public receipt links |
| `PLATFORM_KEYS_JSON` | ✓ | Platform id → hashed API key, HMAC secret ref, webhook URL |
| `EVIDENCE_AGENT_URL` / `EVIDENCE_AGENT_TOKEN` | ✓ | The evidence agent (Astropods or a separate container). **The agent itself gets no PayPal keys** |
| `VISION_MODEL` / `WORKERS_AI_TOKEN` | agent only | Default `@cf/meta/llama-3.2-11b-vision-instruct` |
| `EVIDENCE_INDEX` | | `pgvector` (default) or `elastic` (+ `ELASTIC_URL`, `ELASTIC_API_KEY`) |
| `CHANNEL3_API_KEY` | optional | For `catalog_match`. The free tier works without a key |
| `KERNEL_API_KEY` | demo only | Headless sandbox approval |
| `NOTIFIER` | | `none` / `email` (+ `RESEND_API_KEY`) / `zapier` (+ `ZAPIER_HOOK_URL`) |
| `DEMO_MODE` | | `true` enables `/demo/*` and accepts PayPal simulator events |

```bash
git clone https://github.com/ma-za-kpe/stood && cd stood
cp .env.example .env            # fill the sandbox values above
docker compose up -d db s3 mail
docker compose run --rm app pnpm install
docker compose run --rm app pnpm db:migrate
docker compose up api web       # API on :3000, web on :5173
```

---

## Quickstart (TypeScript SDK)

```ts
import { Stood } from '@stood/sdk';

const stood = new Stood({
  baseUrl: process.env.STOOD_BASE_URL,
  apiKey: process.env.STOOD_API_KEY,
  hmacSecret: process.env.STOOD_HMAC_SECRET,
});

// 1. Create the allowance: what "done" means
const allowance = await stood.allowances.create({
  platform_ref: 'eos-project-123',               // your id (idempotent)
  currency: 'GBP',
  milestones: [
    { name: 'foundation', amount: { minor: 400000, currency: 'GBP' },
      profile: 'construction.stage@1',
      params: { location: { lat: 5.6037, lng: -0.1870, radius_m: 75 },   // synthetic example
                required_items: ['north_wall', 'south_wall', 'overview', 'nonce_card'] } },
    { name: 'blockwork', amount: { minor: 500000, currency: 'GBP' },
      profile: 'construction.stage@1', depends_on: 'foundation' },
  ],
  window_days: 7,
  return_url: 'https://your.app/projects/123/signed',
  cancel_url: 'https://your.app/projects/123/cancelled',
}, { idempotencyKey: 'create-eos-project-123' });

// 2. Send the payer to PayPal to sign once
redirect(allowance.approve_url);

// 3. Later: the stage is ready → hold the money
const held = await stood.tranches.dispatch(allowance.milestones[0].tranche_id,
  { idempotencyKey: 'dispatch-foundation-1' });
// held.state === 'HELD', held.nonce === 'K7Q' → show the code to your inspector

// 4. Submit evidence (Stood copies from your signed URLs)
await stood.tranches.submitPackage(held.id, {
  platform_ref: 'evidence-doc-789',
  photos: [{ item: 'nonce_card', source_url: signedUrl1, lat: 5.60371, lng: -0.18702,
             accuracy_m: 8.5, captured_at_device: '2026-11-02T10:41:58Z' } /* … */],
  platform_signals: [{ type: 'ATTESTATION', verdict: 'PASSED', source: 'firebase_app_check' }],
  complete: true,
}, { idempotencyKey: 'package-evidence-doc-789' });

// 5. The decision arrives by webhook (below). You can also poll:
const t = await stood.tranches.get(held.id); // t.state: RELEASED | REFUSED | WAITING
```

### Freelance example (same endpoint, different profile)

```ts
{ name: 'homepage', amount: { minor: 120000, currency: 'EUR' },
  profile: 'freelance.milestone@1',
  params: { required_items: ['screen_home', 'screen_pricing', 'screen_contact', 'figma_link'],
            artifact_hash: { must_differ_from: 'previous_deliveries' } } }
```

---

## Webhooks you'll receive

Register one HTTPS URL. Every event is signed: `Stood-Signature: t=<unix>,v1=<hex hmac_sha256(secret, t + "." + body)>`.

```ts
import { verifyStoodSignature } from '@stood/sdk/webhooks';

app.post('/stood/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!verifyStoodSignature(req.body, req.header('Stood-Signature'), process.env.STOOD_WEBHOOK_SECRET)) {
    return res.sendStatus(400);
  }
  try {
    const event = JSON.parse(req.body);
    // Your durable inbox adapter must insert the event and jobs in ONE transaction.
    await db.transaction(async (tx) => {
      if (!await tx.events.insertIfAbsent(event.id, event)) return;
      if (event.type === 'tranche.released' && event.data.effect === 'CAPTURE') {
        const captureId = event.data.paypal.capture_id;
        if (!captureId || event.data.paypal.capture_status !== 'COMPLETED') {
          throw new Error('A payout requires confirmed capture');
        }
        await tx.payoutJobs.enqueueOnce(`capture:${captureId}`, event.data);
      }
      await tx.notificationJobs.enqueueOnce(`event:${event.id}`, event);
    });
    return res.sendStatus(200); // acknowledge only after the transaction commits
  } catch {
    return res.sendStatus(503); // Stood retries; do not lose an unpersisted event
  }
});
```

`db` and its inbox/job methods are caller-owned pseudocode, not SDK exports. Jobs run after acknowledgement. The payout worker must reuse the capture-based key with the local processor and reconcile ambiguous results. Event-id deduplication alone cannot prevent two different events from paying the same capture twice. VOID effects (including a successful deposit return) never enqueue a payout. Financial webhook fields remain draft until the payment API is implemented.

| Event | Meaning | Typical action |
|---|---|---|
| `allowance.signed` | The payer approved in PayPal | Enable "dispatch" in your UI |
| `tranche.held` | PayPal authorised the hold | Start matching or inspection. Show the nonce |
| `tranche.funding_failed` | PayPal couldn't hold the amount | Show `sentence.payer`. Don't dispatch |
| `tranche.released` | Captured. The money moved to the platform merchant | Pay the payee on your local rail |
| `tranche.refused` | Voided. `named_field` says why | Show `sentence.inspector` ("what to redo") |
| `tranche.waiting` | A human must decide | Show "in review". The reviewer acts in Stood |
| `tranche.hold_expiring` / `tranche.expired` | The hold is ending or has ended (nothing paid) | Ask the payer to re-approve if needed |
| `dispute.opened` | The payer disputed a release | Link the packet in your admin |

Every event includes `sentence.payer` and `sentence.inspector`, plain-language text you can show as-is.

---

## Evidence profiles

| Profile | Use it for | Key params |
|---|---|---|
| `construction.stage@1` | Build stages verified on site | `location`, `required_items`, stage label |
| `freelance.milestone@1` | Digital deliverables | `required_items`, `artifact_hash`, `link_check` |
| `claims.field_visit@1` | Insurance / lending field visits | `location`, `pair_match` (before / after) |
| `rental.return@1` | Deposits (**inverted:** a match voids the hold, so the deposit is returned) | `pair_match` (checkout vs return) |
| `grant.site_visit@1` | NGO / grant tranches | `location`, `document_fields`, `human_review` |
| `delivery.goods@1` | Goods received | `required_items` (seal, container no.), `document_fields` |

Need another? Open a **Feature or use case** issue. Profiles are compositions of [generic checks](stood/S16-use-cases-and-evidence-profiles.md#check-library-generic), never custom code.

---

## Other ways to plug in

| Path | How |
|---|---|
| **No backend?** | Use the **hosted pages**: redirect the payer to Stood's allowance-sign page, and link the hosted receipt |
| **AI agents** | Connect the **Stood MCP server** (`stood.create_allowance`, `stood.dispatch`, `stood.submit_package`, `stood.get_decision`). Agents pay only for delivery that passes the checks |
| **No code** | Zapier: "New Stood decision" → email, SMS or Slack |
| **Postman** | Fork the public workspace. Environments for sandbox are included |

---

## Limits and guarantees

| | |
|---|---|
| Hold length | Up to **29 days** per tranche (a PayPal authorisation limit). Reauthorised automatically from day 4 |
| Photos per package | ≤ 10, ≤ 8 MB each (JPEG / HEIC / WebP) |
| Rate limits (demo) | 60 req/min per key, 10 packages/min |
| Idempotency | Required on every POST (`Idempotency-Key`, 24h) |
| Money format | Integer minor units + ISO currency. Never floats |
| Decision guarantee | Unknown or uncertain evidence → `WAIT`. **Never an implicit release.** An expired hold pays nothing |

## Errors

RFC 9457 `application/problem+json`. A **refusal is not an error**: it's a `200` with `outcome: "REFUSE"`.

| `type` | HTTP | Fix |
|---|---|---|
| `validation` | 422 | Check the `errors[]` field paths |
| `invalid_state` | 409 | For example dispatching a tranche that's already `HELD` |
| `idempotency_conflict` | 409 | Same key, different body. Use a new key |
| `unauthorized` | 401 | Wrong key or a bad `Stood-Signature` (check the clock skew is under 5 min) |
| `paypal_unavailable` | 503 | Retry with the same idempotency key. State is reconciled automatically |

## FAQ

**Does Stood hold my users' money?** No. PayPal holds it as an authorisation on the payer's account, until Stood captures or voids it. Stood never pools funds.

**Who pays the builder or inspector?** You do, on your local rail (Flutterwave, Paystack, MoMo…), after `tranche.released`.

**Can the AI release money?** No. The model only reports findings. Deterministic rules decide, and the model runs without PayPal credentials.

**Is this production-ready?** Not yet. It's sandbox only during the hackathon. Going live needs PayPal live review, licensing and data-protection steps ([TASKS.md](../TASKS.md) T-0111…T-0115).

**How do I report a security issue?** Privately: [SECURITY.md](../SECURITY.md).
