# S10: Sandbox limits and open questions

## Code-milestone qualification questions

The runner, read-only repository adapter, outside usage receipt and Yard/A2A/AP2 surfaces are planned. Qualify sandbox escape/egress/resource limits, signer identity and key rotation, frozen test counts/skips, mutation scope, diff novelty, dependent packages and builder prompt injection before shipping. Provider funding and real sandbox contracts remain blocked on operator credentials. Field-photo questions below are scenario work.

## What the PayPal sandbox can do (use it for real)

- Orders v2: create with `intent=AUTHORIZE`, authorise, **capture**, **void**, reauthorise (days 4–29).
- Vault v3: setup token → payment token (the allowance / mandate stand-in), **if** vaulting is enabled for the sandbox app (check).
- Order metadata: `custom_id`, `invoice_id`, description, to carry the decision id, allowance id and agent flag.
- Disputes API: sandbox support for creating and answering disputes is **limited**. Verify which dispute flows can be simulated before promising the "filed" state.
- Webhooks for the order and capture lifecycle.
- Agent Toolkit / MCP server, and the APIMatic-generated **PayPal Server SDK** (plus its Context Plugin).

## What it can't do (label, don't call) [U]

- Settle cedis or naira, or pay MoMo / M-Pesa. → The local rail is a **labelled line**: "Builder paid locally by [EyeOnSite](https://github.com/ma-za-kpe/eyeonsite)."
- PayPal World wallet interoperability.
- Pay the field inspector on PayPal. Ghana accounts are send-only in real life, so the demo must not pretend otherwise.

> [C] Optional stretch: **Flutterwave** (PayPal's Xoom partner) and **Paystack** both have test modes for transfers. A real *test-mode* local payout call is possible and more honest than a label. Keep it as a stretch goal behind the rule "label, don't fake". Prefer Flutterwave for the story, because it's already inside PayPal's corridor.

## Open questions

| # | Question | Why it matters | Owner / next step |
|---|---|---|---|
| 1 | Does the authorise → capture / void model work with a **vaulted** payment method, human not present? | It's the core of the money model | Spike in sandbox, week 1 |
| 2 | Builders usually need a **mobilisation advance** before stage 1. How is the first tranche gated? | Construction pays in arrears, but stage 1 needs cash up front | Ask 3 builders in Accra |
| 3 | Is "authorise per stage" enough, or will the buyer’s card / balance fail months later? | Failed capture = builder not paid = trust lost | Retry plus notify design |
| 4 | Payee is the platform ([EyeOnSite](https://github.com/ma-za-kpe/eyeonsite) / Manti Labs LLC). Does disbursing to a builder locally make the platform a money transmitter / PSP in Ghana? | Regulatory | Talk to a Bank of Ghana PSP-licensed partner |
| 5 | Exact copy for the authorisation hold on the buyer’s card statement | Hold confusion triggers disputes | Test |
| 6 | Geofence tolerance: GPS error on cheap phones is often 10–50 m. Default radius? | False refusals hurt the field inspector | Field test, start at 75 m |
| 7 | Can the model reliably tell construction stages apart from 6 photos? | Core AI claim | Collect 50 real photos from [EyeOnSite](https://github.com/ma-za-kpe/eyeonsite) V0 |
| 8 | Trademark / domain for "Stood" | Brand | Search USPTO, UKIPO, Ghana RGD |
| 9 | Can one project win a main prize plus several sponsor prizes? | Prize strategy | Read the Devpost official rules |
| 11 | Licences for AG Studio (and the AI Toolkit, an Enterprise feature) and Bryntum during the hackathon and in a public repo | Commercial components in an open-source repo | Ask at the 12 Oct workshop / sponsor Discord |
| 12 | APIMatic MCP-server generation is alpha, by request | Needed for the "Stood MCP" | Email <support@apimatic.io>, week 1 |
| 13 | Does Channel3 image search identify fixtures from phone photos taken in Ghana? | The spec check depends on it | Test with 20 real fixture photos, week 1 |
| 15 | Do vaulted PayPal wallet tokens support `AUTHORIZE` orders, human not present? | Core of the hold model ([T06](../tech/T06-paypal-integration.md)) | Week-1 spike. Fallback: buyer-present approval per stage |
| 14 | Transaction Search lags up to 3 hours in sandbox too? | The reconciliation widget's timing | Spike, week 1 |
| 10 | the field inspector’s capture: a native KMP app ([EyeOnSite](https://github.com/ma-za-kpe/eyeonsite)) or a PWA for the hackathon? | Build time | **Answered (2026-10-03):** use the real [EyeOnSite](https://github.com/ma-za-kpe/eyeonsite) Android app. It already has offline upload, App Check and evidence signals. Judges without the app use the fixture replays ([T08](../tech/T08-eyeonsite-integration.md)) |
