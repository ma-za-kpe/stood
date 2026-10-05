# S16: Use cases beyond housing, and evidence profiles

> **Stood isn't a housing product. It's a rule:** a signed definition of done + a package of evidence → a PayPal capture **only if they match**. [U]
> **If a use case needs Stood to understand houses, it has already failed.** [U]

[EyeOnSite](https://github.com/ma-za-kpe/eyeonsite) is the first caller because its proof is a person on a plot. Every other caller below is **a different checklist on the same endpoint**.

## 1. Where the same gate applies

| Domain | Payer → payee | "Done" means | Evidence | Who calls Stood | Notes [C] |
|---|---|---|---|---|---|
| **Diaspora construction** | Ama (London) → builder (Accra) | Stage reached on this plot | Geo-photos, code card, stage label | [EyeOnSite](https://github.com/ma-za-kpe/eyeonsite) | The first profile ([T08](../tech/T08-eyeonsite-integration.md)) |
| **Freelance milestones** [U] | Client (Berlin) → designer (Nairobi) | "Homepage, these 3 screens, the Figma link, not a previous delivery" | Files + hashes, a short screen recording, link check | Freelance platform / agency tool | The strongest second demo: fully digital, global, judges understand it in 5s. Upwork holds milestone funds in its own escrow and handles disputes itself. A PayPal-based platform has no evidence-bound payout. **Stood is that reason** |
| **Insurance claims** [U] | Insurer → claimant / repairer | Damage exists / repair done | Field-visit photos, geofence, before / after pair | Claims platform, inspection network | WeGoLook does US field visits for insurers. The payee side is often local rails |
| **Lending draws** [U] | Lender / diaspora mortgage → borrower | Stock in the warehouse, the shop exists, the asset is installed | Site visit, serial-number photo, invoice match | Lender back-office | Results-based draws. Reduces "ghost business" fraud |
| **Agri input finance** [C] | Lender / off-taker → farmer or agro-dealer | Inputs delivered, field planted | Geo-photos at the farm, delivery note, (later) satellite NDVI | Agri-fintech (Farmerline-like) | Founder domain access. Seasonal tranches fit the hold windows |
| **Trade and goods** [U] | Buyer → supplier | Goods received in the stated condition | Container seal and number, vehicle at port, batch photo + weight ticket | Trade / B2B marketplace | ✏️ Correction: **PayPal isn't "the escrow" here.** It's an authorisation hold (≤ 29 days). Longer trade cycles need staged holds or a licensed escrow partner |
| **Rentals and deposits** [U] | Renter → owner (deposit return reversed) | Item returned in the checkout condition | Return photos vs checkout photos (same angles) | Rental platform (equipment, cars, short-lets) | The lock in the other direction: the hold is **voided** (deposit returned) on a match, and **captured** on damage. ⚠️ Holds max out at 29 days, so long-lets need a different deposit mechanism |
| **Grants and NGOs** [U] | Funder (London / DC) → clinic, school, borehole project | The site matches the proposal milestone | Site visit, signboard, beneficiary-safe photos, report PDF | Grant-management tool | Replaces the "PDF emailed late". Strong impact story |
| **Results-based financing / PAYGo energy** [C] | Donor / investor → installer | Solar system installed and working | Install photos + serial + first meter / IoT reading | Energy-access platform | An evidence source can be a **device reading**, not a person |
| **Marketplaces for the unclickable** [U] | Buyer → maker | Custom furniture built, engine rebuilt, farm install done | Build photos, test video, serial | Niche marketplaces already on PayPal payouts | The platform has payouts but no *reason* on them |
| **Public works / CSR** [C] | Agency / company → contractor | Road segment, classroom block, water point | Geo-photos, independent monitor visit | Procurement / CSR platforms | Transparency: the receipt can be public (distance-only) |
| **AI agents paying people** [C] | An agent with a budget → a human or agent supplier | The task's acceptance criteria are met | Artifacts + an automated check | Any agent framework, via the **Stood MCP** | Closes the loop to the original "agent economy" idea ([03](../03-how-agents-make-money-today.md)): agents pay **only for verified delivery** |

## 2. What stays the same in every case

1. **Allowance:** who may be paid, the cap, the currency, the milestones, and **an evidence profile per milestone**.
2. **Hold:** PayPal authorisation on dispatch (≤ 29 days).
3. **Package:** files / artifacts + hashes + optional coordinates + optional device signals + platform signals.
4. **Decision:** release (capture) / refuse (void, named field) / wait (human).
5. **File:** receipt + dispute packet.

## 3. Evidence profiles: how Stood stays industry-blind

A **profile** is a named, versioned list of **generic checks with parameters**. Stood ships a library of checks. Callers compose profiles from it, and they never write code inside Stood.

### Check library (generic)

| Check | Parameters | Used by |
|---|---|---|
| `required_items` | List of item keys (shots, files, screens, documents) | All |
| `location` | Center + radius (+ accuracy rules), *optional* | Construction, claims, agri, grants, trade |
| `capture_window` | Not before dispatch, not after N days | All |
| `novelty` | Near-duplicate threshold, scope (this payer / all callers / seed corpus) | Photos, files, recordings |
| `artifact_hash` | Must differ from previous deliveries, or must equal a declared hash | Freelance, documents |
| `link_check` | URL reachable, owner / domain matches, last-modified after dispatch | Freelance (Figma, GitHub, Drive) |
| `nonce` | Code shown in a photo or recording | Field visits, recordings |
| `classifier_label` | Model + allowed labels + confidence thresholds (refuse threshold optional) | Stage, damage, "three screens present" |
| `pair_match` | Compare against reference images (before / after, checkout / return) | Rentals, claims |
| `catalog_match` | Product spec via Channel3 → WAIT on mismatch | Finishes, marketplaces |
| `document_fields` | Extracted fields equal the allowance values (invoice no., amount, serial) | Lending, trade, grants |
| `device_reading` | Signed device payload within range (meter, IoT) | PAYGo, results-based financing |
| `attestation` | Platform / device attestation verdict required | Mobile capture |
| `human_review` | Always WAIT for a named reviewer role | High-value or regulated milestones |

The **decision rule doesn't change**: hard failure → REFUSE (named field). Uncertainty → WAIT. All pass → RELEASE ([T03](../tech/T03-domain-model.md#decision-rule-pure-function)).

### Built-in starter profiles (v1 / v2)

| Profile id | Checks |
|---|---|
| `code.milestone@1` | signed_tests, test_integrity, test_execution, new_commit, mutation_score (WAIT on weak tests), budget_mandate, usage_release. Rule contract implemented; trusted signature/runner/use ingestion remains T-0159 |
| `construction.stage@1` | required_items, location, capture_window, novelty, nonce, classifier_label(stage), attestation(optional) |
| `freelance.milestone@1` | required_items(files / screens), artifact_hash(differs), link_check, classifier_label("screens present", WAIT-only), novelty(recording) |
| `claims.field_visit@1` | required_items, location, capture_window, novelty, pair_match(before / after), human_review(if amount > X) |
| `rental.return@1` | required_items(same angles), pair_match(checkout vs return), capture_window. **Inverted effect: match → void (deposit back), damage → capture partial** |
| `grant.site_visit@1` | required_items, location, novelty, document_fields(report), human_review |
| `delivery.goods@1` | required_items(seal, container no.), document_fields(waybill), location(optional), novelty |

### Inverted and partial outcomes [C]

Deposits flip the meaning: the "good" outcome is **void**. The profile declares the **effect map**: `{pass: VOID, fail: CAPTURE_PARTIAL(amount from reviewer)}`. Partial capture needs a human amount, so it's always WAIT → reviewer. This is the only extension the core needs.

## 4. Plugging in fast

| Integration path | Effort for a caller | Best for |
|---|---|---|
| **REST + generated SDK** (TS first, then Kotlin / Python via APIMatic) | Hours | Platforms with a backend (EyeOnSite Cloud Functions) |
| **Hosted pages**: the allowance-sign page and receipt / dispute page (white-label via theme tokens) | Minutes (redirect) | Platforms without frontend capacity |
| **Webhooks** with the reason sentence | Minutes | Everyone |
| **MCP server** (APIMatic-generated) | Minutes | AI agents that pay suppliers |
| **Zapier** actions / triggers | No code | Small agencies, NGOs |
| **Evidence intake SDK** (capture spec + nonce UI component) | Days | Platforms building their own capture app |

## 5. What this changes in the technical docs

- **T03:** `Plot` becomes an optional `location` check. `requiredShots` becomes `required_items`. `Stage` becomes `Milestone` (with `stage` kept as a construction-profile label). `Allowance.milestones[].profile = "<id>@<version>"`.
- **T04:** `POST /allowances` takes `milestones[].profile` + `params`. `plot` moves under `params.location`. The v1 API is still pre-release, so this lands before 0.2.0 without a breaking-change cost.
- **The decision record** stores the profile id and version (determinism across callers).
- [ADR-0007](../adr/0007-domain-agnostic-evidence-profiles.md) records the decision.

## 6. Hackathon implication [C]

- **Updated 5 October 2026:** code milestones and agent-to-agent payments are the hero story (PR #24). EyeOnSite remains a concrete site-visit scenario; the former construction-first choice is retained here as historical context. [S17](S17-agent-payments-positioning.md) defines the new trust boundary.
- **Show freelance as the second profile** on the landing page and as a fixture (`freelance-missing-screen`). That proves "one endpoint, many checklists" to the judges in 10 seconds, and it maps to Best Use of Agentic Commerce through the MCP path.
