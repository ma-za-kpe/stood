# S02: Product boundary

**Stood is the gate. Nothing else.**

## The line

> **Stood decides whether a staged payment moves, writes that decision onto the PayPal order, and keeps the file. Stood never holds money, never finds people, and never pays anyone locally.**

## Ownership table

| Concern | Owner |
|---|---|
| Allowance (what "done" means, cap, payee, required shots, plot geofence) | **Stood** |
| Package intake and comparison | **Stood** |
| Decision: release / refuse / wait, with the named field | **Stood** |
| PayPal order: authorise on dispatch, capture on release, void on refuse | **Stood** (using the platform's PayPal credentials) |
| Dispute packet, receipt, reviewer file | **Stood** |
| Inspector and plot record (accepted visits only) | **Stood** (later) |
| Users, sign-up, KYC of inspectors and builders | Platform ([EyeOnSite](https://github.com/ma-za-kpe/eyeonsite)) |
| Inspector matching, routing, ratings | Platform |
| Capture app on the inspector's phone | Platform (Stood offers an intake spec and SDK) |
| Local payouts (builder draw, inspector fee) on Paystack / Flutterwave / MoMo | Platform |
| Merchant of record and funds flow | Platform's PayPal account |
| Customer support | Platform |

## Tests to stop the boundary drifting [C]

Before adding anything, ask:
1. Does it change whether money moves, or what the file says about it? If not, it belongs to the platform.
2. Would Stood have to **hold** money or **know a person** to do it? If so, no.
3. Would a second consumer (a lender, an NGO) need it in the same shape? If not, it's EyeOnSite-specific and belongs in [EyeOnSite](https://github.com/ma-za-kpe/eyeonsite).

## Integration surface (concept, not code)

- **Allowance:** the platform creates it, the payer signs it, Stood returns an allowance id.
- **Dispatch:** the platform says "inspect stage N". Stood authorises the tranche and returns the order id. State: *in review*.
- **Package:** the platform (or the capture SDK) submits the evidence. Stood returns a decision id.
- **Decision event:** sent to the platform: release (plus capture id), refuse (plus named field), or wait (plus reason).
- **Dispute:** the platform asks for the packet. Stood returns a document ready to file.
