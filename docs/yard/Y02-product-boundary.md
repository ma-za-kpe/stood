# Y02: Product boundary

**Yard plans and coordinates the work. Stood decides whether money moves. PayPal moves it. GitHub holds the code.** Yard is a *caller* of Stood, with the same API, the same rules and no back door.

## Ownership

| Concern | Owner |
|---|---|
| Turning an idea into a blueprint (requirements, milestones, acceptance tests, budget) | **Yard: the Foreman** |
| Buyer approval of the blueprint (UI) | **Yard** |
| The payment mandate, holds, captures, voids, receipts and disputes | **Stood** (Yard calls `POST /v1/allowances` etc.) |
| Freezing the acceptance tests (hashing) | **Stood** (Yard submits them with the allowance) |
| Posting work orders, discovery, claims and leases | **Yard: the Board** |
| The A2A surface for builders (agent card, tasks) | **Yard** |
| Building the code | **The builder** (a human, or a Crew agent operated by Yard's operator) |
| Repo creation, and builder access to it | **Yard** (a GitHub App on the buyer's account, scoped to one repo) |
| Running the signed tests and deciding | **Stood** (the runner and the decision) |
| Builder payouts | **PayPal**, to the builder's **operator** account (agents can't pass KYC) |
| Builder reputation | **Yard**, computed only from **Stood decisions** (see [Y13](Y13-security-trust-and-economics.md)) |

## Hard rules

1. **Yard never imports Stood's domain or payment adapters.** It uses the Stood SDK / HTTP API only, enforced by dependency-cruiser ([Y11](Y11-architecture-and-codebase.md)).
2. **Yard holds no PayPal credentials** for buyers. Buyer approval happens in PayPal's window, through Stood.
3. **Yard can't mark a milestone paid.** It only reads Stood's decision and webhooks.
4. **Yard doesn't hold funds,** run escrow, or pool money.
5. **The Crew gets no special treatment.** Yard's own builder agents claim work orders through the same Board rules as anyone, and Stood refuses their bad commits exactly like anyone else's (that's the demo).
6. **Yard writes to a buyer's GitHub only through its GitHub App,** and only to the repo created for that blueprint.

## Tests to stop the boundary drifting

Before adding a feature to Yard, ask:

- Does it decide whether money moves? If so, it belongs in Stood.
- Does it need buyer payment credentials? If so, no.
- Would a third-party builder agent need it in the same shape? If not, rethink it: Yard's Crew is just one builder among many.
