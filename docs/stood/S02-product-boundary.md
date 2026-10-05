# S02: Product boundary

Stood checks agreed evidence before a staged payment moves and keeps the decision record. It never holds pooled funds, writes builder code, pushes commits or merges repositories.

## Ownership

| Concern | Owner |
|---|---|
| Buyer agreement, frozen signed acceptance tests, cap, payee/operator and evidence profile | Stood contract; provider approval binding planned |
| Repository/base/new commit fetch | Planned GitHub read-only adapter; scoped read token only |
| Secret-free, network-free test execution and signed report | Planned isolated runner; separate from payment API |
| Evidence assessment, named condition, durable reservation and matching settlement | Stood |
| Building code, hiring/subcontracting, user identity and onward payouts | Calling platform and accountable builder operator |
| Agent discovery/task negotiation | Planned A2A surface; does not grant payment authority |
| Mandate exchange | Planned AP2 surface; does not prove delivery |
| Payment authorisation/capture/void | PayPal via guarded Stood adapter |

## Current boundary

The code profile checks synthetic RULE findings; it is not a signed test verifier. DRAFT creation is implemented, financial HTTP and trusted evidence intake are not. A builder-provided green report cannot release money. Yard is planned in a separate repo, with an operator and a bounded mandate. Human/agent labels never affect verdicts.

## Scenario: site visits

[EyeOnSite](https://github.com/ma-za-kpe/eyeonsite) owns matching, capture app, users and local payouts. Stood assesses its field package through a profile. These responsibilities do not move into the code-milestone core.
