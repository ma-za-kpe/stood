# 10: Risks and open questions

> Historical framing (before the 5 Oct 2026 repositioning). See [S17](stood/S17-agent-payments-positioning.md).

Product-level sandbox questions live in [S10](stood/S10-sandbox-limits-and-open-questions.md). This doc covers project-level risks.

## Top risks (ranked) [C]

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | **Evidence is fakeable**, so Stood releases money blindly with a nicer UI | High without defences | Fatal | [S11](stood/S11-evidence-integrity.md): nonce, near-duplicate search, in-app capture, wait-not-refuse |
| 2 | **Money model breaks real PayPal rules.** Escrow needs pre-approval under the AUP. Authorisations expire at 29 days. Delayed disbursement auto-releases at 28 days | High if we copy the pasted design | High for adoption, low for the hackathon | "Authorise on dispatch, capture on proof". Never call it escrow ([09](09-stood.md)) |
| 3 | **Inspector paid on PayPal in Ghana**, which isn't possible (send-only) | Certain if built | Judges with PayPal context spot it | Kojo never touches PayPal. Local rail is labelled ([S03](stood/S03-personas.md)) |
| 4 | **Crowded field.** Mandate / budget agents already submitted (Mandat) | Certain | Medium | Position on *evidence*, not *budget* ([06](06-paypal-hackathon.md)) |
| 5 | **The AI claim fails on real photos** (stage recognition) | Medium | High | Collect real photos in week 1. Low confidence → wait |
| 6 | **Regulatory: platform as money transmitter / PSP** in the US (state MTLs) and Ghana (Bank of Ghana PSP licence) | Medium (real world) | High (post-hackathon) | Stood never holds funds. Platform uses licensed partners (Flutterwave / Paystack) |
| 7 | **Defamation / brand risk**: the video shows Paga or PayPal failing | Medium | Medium | Neutral reconstructions, no logos, factual claims with sources |
| 8 | **Scope creep into [EyeOnSite](https://github.com/ma-za-kpe/eyeonsite)** (matching, ratings, maps) | High | Medium | Boundary tests in [S02](stood/S02-product-boundary.md) |
| 9 | **The solo-builder timeline** (5.5 weeks) | Medium | High | Week-by-week exit checks in [S12](stood/S12-hackathon-plan.md). Submit a day early |
| 10 | **False refusals hurt honest inspectors** and the trust of the very people this is for | Medium | High (ethically) | Track the false-refusal rate. Human review on low confidence |
| 11 | **Construction finance reality**: builders need advances, not arrears | High | Medium | Open question Q2 in [S10](stood/S10-sandbox-limits-and-open-questions.md) |
| 12 | **Demo dies on judging day** (cold start, expired sandbox token) | Medium | High (Best Demo Delivery) | Keep warm on Render. A fixtures path that doesn't depend on live state |

## Strategic open questions

1. Is Stood a **standalone company / API** or **an [EyeOnSite](https://github.com/ma-za-kpe/eyeonsite) module**? The docs assume a separate API with [EyeOnSite](https://github.com/ma-za-kpe/eyeonsite) as the first consumer. That needs deciding before any fundraising story.
2. Does Stood ever become an **AP2-native** component (export allowances as AP2 intent mandates)? It would make Stood relevant to PayPal's FIDO / AP2 work.
3. Second consumer after [EyeOnSite](https://github.com/ma-za-kpe/eyeonsite): input-finance (Farmerline-adjacent), insurance claims, or NGO disbursement? See [08](08-idea-bank.md) #24–26.
4. Does the original "agent economy" vision come back once Stood exists? Stood is a primitive an agent economy needs: **payment contingent on verified delivery**. That's the "force value creation" rule from [03](03-how-agents-make-money-today.md) turned into a product.
