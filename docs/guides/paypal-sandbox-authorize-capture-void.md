# PayPal sandbox: authorize, capture and void, step by step

A practical guide for developers who hold money first and decide later: **authorize** a payment, then either **capture** it (release) or **void** it (refuse). It is written from Stood's own setup on 7–8 October 2026, including every error we hit and how we fixed it. Everything here uses the PayPal **sandbox**; no real money moves.

Stood's code for each step is linked, so you can read a working, tested implementation.

## 1. Accounts: who owns the app matters

PayPal sandbox has two kinds of test accounts, created under developer.paypal.com → **Sandbox → Accounts → Create account**:

| Account | Role | Country |
|---|---|---|
| **Business** (merchant) | Owns your REST app and **receives** the money | Pick one that can receive. We used **United States** |
| **Personal** (buyer) | Logs in at checkout and **approves** the payment | Also **United States** |

**Lesson 1: the business account's country decides whether it can receive.** Our first app was owned by a Ugandan business account. Checkout failed with `PAYEE_ACCOUNT_LOCKED_OR_CLOSED`: in PayPal, accounts in several countries can only send. Use a business account in a country that can receive.

**Lesson 2: the app's owner must be the payee if you need to void.** We first kept the old app and named a US business account as the order's payee. PayPal let the app **capture** that hold, but answered **void** with **HTTP 403**: only the payee's own app may void its authorizations. If your flow can refuse a payment, create the app **under the receiving business account**. An app's owner cannot be changed later; create a new app instead.

## 2. Create the app

developer.paypal.com → **Apps & Credentials** (Sandbox) → **Create App**:

1. **Type: Merchant.** "Platform" is PayPal's marketplace product; it needs seller onboarding, and its delayed disbursement releases automatically after 28 days.
2. **Sandbox account:** the receiving business account from step 1.
3. **Features** for authorize/capture/void with saved payment methods: *Save payment methods (Vault)*, *Transaction search*, *Customer disputes*, *JavaScript SDK v6*. Orders, authorize and capture are always on.
4. Copy the **client ID** and **secret** into a gitignored `.env` (mode 600). Never commit them or paste them into chats or issues.

**Lesson 3: use the API host, not the website host.** The API is `https://api-m.sandbox.paypal.com`. `https://sandbox.paypal.com` is the sandbox *website*; it answered some token requests too, which hid the mistake for a while. Accept only the exact API host in code.

Check the keys without printing the token:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -u "$PAYPAL_CLIENT_ID:$PAYPAL_CLIENT_SECRET" \
  -d grant_type=client_credentials https://api-m.sandbox.paypal.com/v1/oauth2/token
```

**Lesson 4: the sandbox token endpoint is occasionally flaky.** Valid credentials got HTTP 401 about twice in fifteen calls, then succeeded seconds later. Getting a token moves no money, so retry it with a short backoff. Never blindly retry a capture or void; use `PayPal-Request-Id` idempotency instead.

## 3. Authorize, then capture or void

Stood's run tool does the whole sequence through its production adapter ([`sdk.ts`](../../services/api/src/adapters/payments-paypal/sdk.ts), [`sandbox-run.ts`](../../services/api/src/application/sandbox-run.ts)):

```bash
scripts/dev sandbox-run release   # authorize, then capture
scripts/dev sandbox-run refuse    # authorize, then void
```

1. **Create the order** with `intent: AUTHORIZE` and `Prefer: return=representation` (the default *minimal* reply leaves out the purchase units and payee).
2. **The buyer approves** at the link with `rel: payer-action` (or `approve`). Log in as the **Personal** account.
3. **Poll the order** until its status is `APPROVED`.
4. **Authorize the order.** The response holds the authorization id and its expiry (29 days in the sandbox).
5. **Capture** (`POST /v2/payments/authorizations/{id}/capture`) or **void** (`.../void`), each with a stable `PayPal-Request-Id`, so a retry can never capture twice.
6. **Read the authorization back** (`CAPTURED` or `VOIDED`) rather than trusting the first reply.

**Lesson 5b: ask for the representation, and read the result back.** With `Prefer: return=representation`, the sandbox answered **capture with 201** and **void with 200**, each with the resource; without it, void answers 204 with no body. Either way, confirm by reading the authorization (`GET /v2/payments/authorizations/{id}` → `CAPTURED` or `VOIDED`) rather than trusting the first reply. Our simulator had assumed 204 for void; the real recordings caught it.

**Lesson 5: a new buyer account may have no way to pay.** Checkout showed "Add a credit or prepaid card". Generate a fake sandbox card under **Sandbox → Card testing**, and add it at checkout.

**Lesson 6: checkout error pages carry a base64 code.** The `code=` parameter in `…/genericError?code=…` decodes to the reason:

| Code (decoded) | Meaning | Fix |
|---|---|---|
| `PAYEE_ACCOUNT_LOCKED_OR_CLOSED` | The receiving account cannot receive | A business account in a country that can receive (lesson 1) |
| `PAYMENT_ALREADY_DONE` | The approval link was opened again after approval | Nothing; it already worked |

```bash
echo 'UEFZTUVOVF9BTFJFQURZX0RPTkU=' | base64 -d   # PAYMENT_ALREADY_DONE
```

## 3b. Save the buyer once, then hold without them (Vault)

For later milestones the buyer should not have to approve every hold. PayPal's Vault saves their PayPal as a payment token once; later orders name the token and need no approval.

```bash
scripts/dev sandbox-run vault-setup     # the buyer approves saving PayPal, once
scripts/dev sandbox-run vault-release   # a later hold from the saved token, then capture: no approval
scripts/dev sandbox-run vault-refuse    # a later hold from the saved token, then void
```

1. **Create a setup token** (`POST /v3/vault/setup-tokens`, `payment_source.paypal` with return and cancel URLs on one https origin).
2. **The buyer approves** at its `approve` link.
3. **Read the setup token back** until `APPROVED`; it carries PayPal's `customer.id`.
4. **Create the payment token** (`POST /v3/vault/payment-tokens` from the setup token and the customer id). Treat its id as a secret: it is a standing permission to charge the buyer. The run tool keeps it in `.env` only and never records it; the product keeps it in the signed mandate, out of funding records and logs.
5. **Later holds:** create the order with `payment_source.paypal.vault_id` = the token and `intent: AUTHORIZE`. No approval link is needed, and **the sandbox authorizes at once**: the create call answers `COMPLETED` with the authorization already in `purchase_units[0].payments.authorizations`. Skip the separate authorize call and go straight to capture or void.

**How Stood does step 5 (T-0154).** When a buyer has a signed saved-PayPal mandate, a tranche's funding is marked `SAVED_PAYPAL` when it is reserved. The funding record never holds the token: the PayPal adapter looks it up from the mandate only at the moment it calls PayPal. A `COMPLETED` create is read as the hold itself, so funding goes straight from `CREATING` to `HELD` (or `FAILED` on `INSTRUMENT_DECLINED`). If the create reply is lost, Stood reads the order instead of creating another one. Everyone else still goes through buyer approval, and the database refuses the shortcut for them (migration 0020).

**Lesson 10: setup tokens need `usage_type: MERCHANT`.** Without it, PayPal creates the setup token with status `CREATED` and **no approval link**, so no buyer can ever approve it. With it, the status is `PAYER_ACTION_REQUIRED` and there is an `approve` link. We found this when our first real setup run returned no link; the fix was one field.

## 4. Check what PayPal recorded, independently

Don't trust your own code's view alone. Stood keeps a second, independent reader ([`tools/paypal-witness`](../../tools/paypal-witness/witness.py), Python standard library only, read-only):

```bash
tools/paypal-witness/witness.py order ORDER_ID          # authorizations and captures
tools/paypal-witness/witness.py transactions START END  # Transaction Search, at most 31 days
tools/paypal-witness/witness.py disputes
```

**Lesson 7: Transaction Search is not immediate.** A capture did not appear in Transaction Search within minutes. PayPal documents a delay of up to about three hours; reconcile with a window that allows for it, and read the order or capture directly when you need an answer now.

**Lesson 8: Transaction Search accepts at most 31 days per request**, in pages. Stood's SDK reader pages through `total_pages` and refuses longer windows ([`captures()`](../../services/api/src/adapters/payments-paypal/sdk.ts)).

**Lesson 11: Transaction Search lists every balance event, not only payments.** Our first audit flagged `32H01288U93789309` as a capture with no release: it was event `T1900`, the sandbox account's opening balance. Payment events have codes starting `T00` (`T0006` is a PayPal checkout payment); keep only those when you compare captures (T-0155).

**Lesson 12: an audit needs a way for a person to close a finding.** A capture made outside your app (we captured `3WS56911LU245183B` with an operator tool) is real money PayPal reports and your ledger never saw, so it is flagged every hour. Stood lets a named person resolve it with a reason (`scripts/dev findings resolve <id> --by <name> --note "<reason>"`); the audit then never reopens it (T-0257).

## 5. Webhooks

Add **one** webhook on the app for the events you handle (we use `CHECKOUT.ORDER.APPROVED`, `PAYMENT.AUTHORIZATION.CREATED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.AUTHORIZATION.VOIDED`), not "all events". Verify every delivery with `POST /v1/notifications/verify-webhook-signature`, store each event id once (PayPal retries), answer quickly, and treat an event as a hint: read the payment itself before acting. Stood's receiver: [`webhook-verifier.ts`](../../services/api/src/adapters/payments-paypal/webhook-verifier.ts).

**Lesson 9: a webhook belongs to one app.** When you create a new app (lesson 2), add the webhook again and use its new webhook id.

## 6. AI tooling

- The **PayPal AI Toolkit** for Claude Code adds a best-practices skill and a sandbox MCP server. On 8 October 2026 every MCP tool we tried answered `Unsupported cache mode: default` ([paypal/AI-Toolkit#34](https://github.com/paypal/AI-Toolkit/issues/34)); the read-only witness above stands in. Its token expires every 8–9 hours; [`tools/paypal-mcp-token`](../../tools/paypal-mcp-token/README.md) renews it automatically on macOS.
- The **APIMatic PayPal Context Plugin** grounds coding agents in the PayPal Server SDK. Its guidance (construct controllers from the client, call list operations with one options object, read `debug_id` from `ApiError`) shaped Stood's Transaction Search reader ([T16](../tech/T16-paypal-ai-toolkit.md#apimatic-paypal-context-plugin)).

Found a mistake or a newer behaviour? Open an issue or a pull request: <https://github.com/ma-za-kpe/stood>.

## Results from our sandbox (8 October 2026)

Two runs through Stood's production adapter, each confirmed by the independent witness:

| Run | Order | Result |
|---|---|---|
| Release | `5DR752893E000704A` | authorization `CAPTURED`; capture `COMPLETED`, 10.00 USD, `invoice_id` = Stood's operation key |
| Refuse | `64V46505SU3606334` | authorization `VOIDED`; no capture, nothing charged |
| Vault setup | setup `0TL2283216418424J` | buyer approved saving PayPal; token kept in `.env` only |
| Vault release (no buyer) | `5KD70970Y9323125U` | authorized at creation, then `CAPTURED`, 10.00 USD |
| Vault refuse (no buyer) | `4EP95447F22898734` | authorized at creation, then `VOIDED`; no capture |

The sanitised recordings (ids, statuses, amounts; no payer data) are in [`services/api/test/scenarios/sandbox/`](../../services/api/test/scenarios/sandbox/). Earlier runs that failed (the Ugandan payee, and the 403 void with a third-party payee) are kept there too, because they are the evidence for lessons 1 and 2.
