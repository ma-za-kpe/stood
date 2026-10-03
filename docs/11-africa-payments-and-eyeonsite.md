# 11: Africa payments climate and [EyeOnSite](https://github.com/ma-za-kpe/eyeonsite)

## The payments weather [U, audited]

- **Remittances to Africa:** about $95–100B a year ([EyeOnSite](https://github.com/ma-za-kpe/eyeonsite) cites World Bank / KNOMAD 2024). Thick corridors are Nigeria, Egypt, Ghana and Kenya. *Not independently re-verified [C]. See [EyeOnSite](https://github.com/ma-za-kpe/eyeonsite)'s EOS-13 sources.*
- **Rails that move money are solved:** Flutterwave, **Paystack (owned by Stripe; separate API; settles in NGN / GHS / KES)**, LemFi, NALA, Chipper, M-Pesa, MTN MoMo.
- **Mobile money** is how people spend. Africa is about 70% of global mobile-money value [U].
- **Paystack Ghana** [C, confirmed]: transfers to MoMo (MTN, Vodafone / Telecel, AirtelTigo) at **GHS 1 per transfer**, and to bank accounts (GHIPSS) at GHS 8. Single and bulk transfer APIs exist. This is the natural local rail for [EyeOnSite](https://github.com/ma-za-kpe/eyeonsite)'s payouts.

## PayPal in Africa [U, audited]

| Claim | Audit |
|---|---|
| PayPal World (UPI, WeChat Pay, Mercado Pago; about 2B wallet users), with Africa promised for 2026 via wallet partners | **Confirmed [C]** as a plan. Talks with M-Pesa and Flutterwave reported. Not live as a callable product |
| Xoom → Nigerian bank accounts in naira via **Flutterwave**, July 2026 | **Confirmed [C]** (13 July 2026). Settles into Access, UBA, Zenith, First Bank, GTBank and others |
| **Paga link**, 27 Jan 2026: receive and withdraw only; Checkout / goods-and-services not enabled | **Receive-only confirmed [C].** "Checkout not enabled" is consistent with reporting ("missing merchant features") but **wasn't seen on Paga's help page directly**. Verify before quoting |
| Users hit holds of up to 21 days, linking failures, bans after uploading documents | **Broadly confirmed [C]:** WeeTracker (24 Feb 2026) and Technext report frozen accounts, funds held (one user until 9 March), accounts closed after receiving $290, and linking and verification failures. "21 days" is the usual PayPal hold length and fits the reports, **but no single source states it for Paga**. Use "held for weeks" in public copy |
| Paga processed about ₦17T across 169M transactions in 2025 | Not re-verified [C]. Treat as [U] |
| $100M MEA fund stalled; PayPal Ventures paused | Not re-verified [C] |
| **Ghana** | [C, new] PayPal accounts in Ghana are **send-only**. Ghanaians can't receive (workarounds via Payoneer). This matters for Stood's design ([09](09-stood.md)) |
| **Bangladesh** freelancer ID | [C] A real government portal (freelancers.gov.bd, Jan 2026), but it's aimed at **banking access generally**. PayPal still isn't available in Bangladesh (Payoneer integration is the workaround). The pasted "built because PayPal verification was the bottleneck" overstates the cause |

## Why PayPal can't simply "launch" in Nigeria or Ghana [U + C]

PayPal's risk model treats a **new account + a sudden large inbound payment + no proof of delivery** as fraud. Partners (Paga) sit in front of that model, but they can't change it. **Stood's insight:** don't fight the risk model, give it what it's missing. Make payments **small, frequent, and each tied to evidence**, and attach the reason to every hold. Then a hold becomes a state on a job, not a missing balance.

## [EyeOnSite](https://github.com/ma-za-kpe/eyeonsite) (the user's existing project) [U]

Source: `ma-za-kpe/eyeonsite`, docs/EOS-01-VISION-AND-MARKET.md (May 2026, v0.1).

- **One-liner:** "Bolt for physical verification": on-demand, geo-matched inspectors who provide GPS-stamped, escrow-backed evidence that diaspora investments and enterprise operations in Africa are real.
- **Two-sided:** clients (diaspora, fintechs, insurers, NGOs) ↔ inspectors (engineering students, surveyors, gig workers).
- **Flow:** post task → escrow (Stripe for diaspora, Flutterwave local) → geo-match → capture → auto-validate → 48h review → release or dispute (7 days).
- **White space:** African players are managed services (LandSafe, Mantel Verify, LANDIZ, The Diaspora Access). Marketplace players are US-only (WeGoLook, iVueit, ProxyPics).
- **Founder advantages:** based in Accra, MEST alumnus, senior Android / KMP developer at Farmerline, Manti Labs LLC (Delaware), Ugandan and Ghanaian corridors.
- **Roadmap:** V0 manual (WhatsApp + Forms) → V1 KMP MVP in Accra, construction → … → V5 the trust-verification layer for Africa.

### Claude's notes on [EyeOnSite](https://github.com/ma-za-kpe/eyeonsite) [C]

1. **V5 ("the trust verification layer") is Stood.** Pulling the gate out as its own API now is consistent with [EyeOnSite](https://github.com/ma-za-kpe/eyeonsite)'s own roadmap. It doesn't distract from it.
2. **[EyeOnSite](https://github.com/ma-za-kpe/eyeonsite) plans Stripe for diaspora escrow.** Stripe has escrow / holding restrictions similar to PayPal's AUP. The "authorise on dispatch, capture on proof" model ([09](09-stood.md)) works on either processor and should go into [EyeOnSite](https://github.com/ma-za-kpe/eyeonsite)'s docs too.
3. **Statistics to verify** before they appear in a pitch or video: "70% of Lagos real-estate purchases in 2021 by diaspora", "56%+ cite corruption as #1 barrier", and the Egypt figure ($22.7B is plausible for 2024 but should be checked against the World Bank's latest brief).
4. **Remittance-fee context:** the Sub-Saharan Africa corridor is the world's most expensive (World Bank Remittance Prices Worldwide, typically about 8% vs the SDG target of 3%). Worth a line in the impact story. *Not re-verified for 2026.*
