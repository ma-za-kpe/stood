# 07: PayPal landscape (2026)

## Company state [U, audited]

| Claim | Audit |
|---|---|
| CEO Alex Chriss removed in early Feb, 2027 targets pulled, stock fell about 20% in a day | **Confirmed [C]:** board acted on **2 Feb 2026**. **Enrique Lores** (HP; PayPal board chair since July 2024) is CEO from **1 Mar 2026**, with CFO/COO Jamie Miller as interim. Board said execution "has not met expectations" |
| Reorganised into three businesses in April | **Confirmed [C]:** **29 Apr 2026**. (1) Checkout Solutions & PayPal (Frank Keller), (2) Consumer Financial Services & Venmo (Alexis Sowa, interim), (3) Payment Services & Crypto (Jeff Pomeroy, interim): Braintree, SMB processing, value-added services, PYUSD. **At least $1.5B in gross annualised savings** targeted over 2–3 years [C, new] |
| Branded checkout grew about 1%; volume +9% but transaction margin +1%; about 439M active accounts, flat since 2021; FY25 revenue $33.2B | Not independently re-verified. Consistent with coverage. Treat as [U] |
| Agentic payments and digital identity "material from 2028" | [U], not re-verified |
| Cymbio acquisition | **Confirmed [C]:** announced 22 Jan 2026, **closed 5 Feb 2026**. A Tel Aviv multi-channel orchestration platform. **Store Sync is effectively Cymbio** (live brands: Abercrombie, Fabletics, Ashley, Newegg, Adorama on Copilot and Perplexity) |
| Agent Ready / Store Sync | **Confirmed [C]:** launched Oct 2025. Agent Ready available early 2026, expanding. Partners include Wix, BigCommerce, Shopware, Perplexity, Copilot. ChatGPT and Gemini "coming soon" |

## Volume mix [U]

About $1.9T total payment volume:
- Unbranded processing (Braintree / Enterprise): about 44%. Largest share, lowest take rate.
- Branded checkout: about 30%. Slowest-growing, highest margin.
- P2P: about 26%. Venmo about 18% of total and nearly all US.
- Xoom: thin cross-border remittance pipe.

Q1 2026 was $464B, up 11%. Growth came from Venmo, enterprise processing and debit cards.

**Who's on each side [U]:** shoppers (about 439M accounts, about 225M monthly active), merchants (about 36M business accounts), **platforms and marketplaces paying out to many people** (refunds: Southwest pushed about $250M to 200k customers in 6 weeks; drivers; creators), donors (Giving Fund), borrowers (Working Capital, $1K–$250K repaid as a share of sales), and debit / tap-to-pay.

## Competitors [U]

- **Stripe:** wins developers and won the first agent. Link was in Muse on day one.
- **Apple Pay:** owns the phone.
- **Shop Pay:** owns the Shopify checkout. Shopify became an AI channel.
- **Klarna:** owns the "pay later" decision.
- **Adyen, Block:** enterprise and in-person.
- **Wero:** a new EU scheme, about 3% of German shops.
- A crawl of 3.8M sites [U, single source]: PayPal button on 57% of sites with a payment tool, Apple Pay 39%, Shop Pay 27%, Stripe 15%.

## Meta Muse and agentic commerce (Sept 2026) [U, confirmed by C]

- **8 Sept:** Muse launches (US/Canada, adults) with **Stripe Link**. It uses a saved payment method where Link is accepted, otherwise a single-use virtual card scoped to the approved purchase.
- **20–21 Sept:** **Amazon blocks Muse.** The reasons given: no permission, the agent doesn't identify itself, and alleged capture of login credentials. **21 Sept:** Shop Pay across Shopify (Agentic Storefronts). **22 Sept:** PayPal added for global merchant reach, on Mastercard Agent Pay rails. **23 Sept:** Meta Connect. Also Expedia and Instacart.
- **Gaps Muse leaves [U]:** merchants can't see an agent made the order. The catalog is a club. Protection is US-consumer and Stripe's. Geography is US-only. The agent impersonates the user.

## Standards [U + C]

| Protocol | Who | Does |
|---|---|---|
| x402 | Coinbase → x402 Foundation (Linux Foundation). Visa, Mastercard and Ripple joined | Pay-per-HTTP-request in stablecoins, machine to machine |
| **AP2** | Google → **donated to FIDO Alliance (28 Apr 2026)**. v0.2 adds **human-not-present autonomous payments** | Signed intent, cart and payment mandates. PayPal is in the FIDO working groups with Visa, Amex, Stripe, Adyen, Mastercard and others |
| ACP | OpenAI + Stripe | In-chat checkout. PayPal supports it via Braintree |
| UCP | Google + Shopify | Discovery, cart, loyalty |

> **[C, new] Security research to cite:** *"Signing the Transaction but Not the Decision: Whisper Attacks"* (arXiv 2609.11757, Sept 2026). Manipulated product descriptions trick AP2 agents into wrong purchases that still carry **valid signatures**. The proposed defence binds signed intent to its origin as a capability. **Lesson for Stood:** a signature proves *who* approved, not that the *decision* was right. Stood binds a release to **evidence**, which closes that gap.

## PayPal does not have an x402 equivalent [U]

PayPal sits on the "a human authorised this, a merchant got paid on fiat rails" side. Its agent pieces are the AP2 mandate model, ACP via Braintree, and the Agent Toolkit / MCP server.

## Geography [U]

- **Absolute scale:** the US is about half of revenue.
- **Relative dependence:** Germany (about 85% usage among payment-service users, about 96% of shops), Italy, Austria, Australia.
- **Near zero:** China, Japan, Korea.
- **Africa:** see [11](11-africa-payments-and-eyeonsite.md).

## How fraudsters use AI against PayPal [U]

Account takeover followed by fast agent purchases. Jailbroken or badly specified budget agents. Automated "item not received" floods. Agents that strip buyer protection by typing card numbers into sites. Skimmers planted through agents.

**[C, confirmed]:** on **22 Sept 2026** six banks (ASB, Bank of America, Capital One, CommBank, ING, NatWest) published a report warning that consumers don't know **who is responsible or who to call** when an agent buys wrongly. They proposed disclosure of agent involvement, transparency about agent decisions, and data safeguards.
