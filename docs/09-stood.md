# 09: Stood (product overview)

> **Money does not move until someone stood there.**

Stood is the **release gate** a platform calls before a staged payment leaves. A payer abroad signs what "done" means (an *allowance*). An evidence source (an inspector's phone) submits a *package*. Stood decides **release**, **refuse**, or **wait**, and writes that decision onto the PayPal order. A dispute then becomes a file, not a story. The local payout stays on a local rail, and Stood never pretends to settle cedis.

[EyeOnSite](https://github.com/ma-za-kpe/eyeonsite) ([11](11-africa-payments-and-eyeonsite.md)) is the **first consumer, not the owner**. The same API serves lenders, insurers, NGOs and input-finance programmes ([08](08-idea-bank.md) #24–26).

## How the whole research thread ends up here [C]

| Thread | Where it lands in Stood |
|---|---|
| Pyramid / "ultimate user" test ([02](02-pyramid-schemes-and-ignition.md)) | Inspector and plot records only improve from **accepted visits paid for by clients outside the inspector's tree**. New accounts paying each other graduate no one |
| Force value creation ([03](03-how-agents-make-money-today.md)) | Money moves **only against delivered evidence** |
| Better than Muse ([07](07-paypal-landscape.md)) | The agent spends against **proof**, not a product feed. It identifies itself as an agent on every order |
| AP2 mandates / Whisper attacks | Allowance ≈ intent mandate. Release is bound to evidence, not just to a signature |
| Identity as export licence | The inspector record and plot record |
| Paga's silent holds ([11](11-africa-payments-and-eyeonsite.md)) | A hold is **a state on a job with a sentence attached**, not a missing balance |
| Simulation ([05](05-simulation-design.md)) | Test harness: synthetic honest inspectors, recyclers, spoofers and collusion rings |

## The money model [C, important correction]

The pasted plan said "capture a PayPal payout to the inspector" and "the platform holds escrow". **Both break in the real world:**

1. **Ghanaian PayPal accounts can't receive money** (send-only; Nigeria only receives via the Paga link). Kojo can't be paid on PayPal.
2. **PayPal's Acceptable Use Policy requires pre-approval for escrow services.** A hackathon demo in sandbox is fine. A real product called "escrow" is not, without approval.
3. **Authorisations last 29 days** (3-day honour period). **Multiparty delayed disbursement maxes out at 28 days and then auto-releases.** House stages take months.

**Recommended model: "authorise on dispatch, capture on proof".**
- Ama signs the allowance once. PayPal **Vault** saves her payment method (the mandate stand-in).
- When a stage is ready for inspection, Stood creates an Orders v2 order with **intent AUTHORIZE** for that tranche. This is the *hold*: "This tranche is in review until the photos match." Inspections take about 48 hours, inside the honour period.
- **Release:** capture the authorisation. The payee is the **platform's** PayPal merchant account ([EyeOnSite](https://github.com/ma-za-kpe/eyeonsite) / Manti Labs LLC, a US entity that can receive).
- **Refuse:** **void** the authorisation. Ama's money never left her.
- The platform then pays the builder and the inspector fee locally (Paystack or Flutterwave MoMo), outside Stood.

Why this is better: no long-lived pooled escrow, no 28-day auto-release surprise. It uses PayPal's own primitives exactly as designed, and **Stood never holds money: it decides and records.** That's a much easier regulatory position (see [10](10-risks-and-open-questions.md)).

## Where the AI is (so "meaningfully uses AI" is clearly true) [C]

| AI does | Rules do |
|---|---|
| Recognise the build stage in the photos (foundation vs blockwork vs roof) | Plot geofence check (distance plus tolerance) |
| Detect photo-of-a-screen, stock images, re-shot prints | Required shots present, timestamps inside the window |
| Read the **nonce** (a code the inspector writes on paper, see [S11](stood/S11-evidence-integrity.md)) | Near-duplicate check against all prior packages (vector search) |
| Write the one-sentence reason, and draft the dispute packet | **The final release / refuse / wait decision** |
| Act as Ama's agent: human-not-present capture under the allowance | Amount ≤ allowance cap. Payee = the allowance payee |

**Principle: the model reports findings with confidence. Deterministic rules move money.** Low confidence never refuses, it only **waits** and routes to the reviewer.

## Stood product docs

| # | Doc |
|---|---|
| S01 | [Problem statement](stood/S01-problem-statement.md) |
| S02 | [Product boundary](stood/S02-product-boundary.md) |
| S03 | [Personas](stood/S03-personas.md) |
| S04 | [Job story and the three outcomes](stood/S04-job-story-and-outcomes.md) |
| S05 | [Feature list](stood/S05-feature-list.md) |
| S06 | [Voice and states](stood/S06-voice-and-states.md) |
| S07 | [Brand and design tokens](stood/S07-brand-and-design-tokens.md) |
| S08 | [Screens](stood/S08-screens.md) |
| S09 | [Demo script](stood/S09-demo-script.md) |
| S10 | [Sandbox limits and open questions](stood/S10-sandbox-limits-and-open-questions.md) |
| S11 | [Evidence integrity](stood/S11-evidence-integrity.md) [C, new]: how the evidence gets faked, and the defences |
| S12 | [Hackathon plan](stood/S12-hackathon-plan.md) [C, new]: criteria mapping, 6-week timeline |
| S13 | [Partner integration map](stood/S13-sponsor-integration.md): all ten partners plus PayPal |
| S14 | [Open-source plan](stood/S14-open-source-plan.md) |
| S15 | [Design system](stood/S15-design-system.md) |

**Rule under all of it [U]:** *the screen decides money. If a frame doesn't release, refuse, or dispute, it doesn't ship.*
