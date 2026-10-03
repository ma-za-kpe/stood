# S05: Feature list

## Must (hackathon) [U + C]

1. Create allowance (plot, geofence tolerance, stages, cap, payee, required shots)
2. Sign allowance (PayPal Vault approval as the mandate) [C: names the PayPal object]
3. Dispatch a stage → **authorise** the tranche (the "in review" hold) [C]
4. Submit package (GPS, server time, photos, checklist, nonce)
5. **Plot check** (distance vs tolerance)
6. **Reused-photo check**: near-duplicate (perceptual / embedding), not exact hash [C: exact hashes are beaten by a one-pixel edit]
7. Stage recognition by vision model, plus a screen / print re-capture check [C]
8. Decide: release / refuse / wait, with the **named field**
9. Write to the PayPal order: agent flag, allowance id, evidence reference
10. **Capture only on release. Void on refuse.** [C: void, not just "no capture"]
11. Dispute packet
12. Receipt link (opens without an account)
13. Reviewer file (the one-screen audit)
14. Fixtures: good / wrong-plot / recycled / wrong-stage / substituted-fitting packages, so judges can replay every outcome [C: the submission needs a demo judges can actually use]
15. **Fixtures and finishes spec check** (Channel3 lookup + image search → WAIT on mismatch, never refuse) [C]
16. **Reviewer file in AG Studio** with two data sources (Stood decisions + PayPal Transaction Search) and the **reconciliation / gate-bypass** widget [C]
17. **Bryntum Gantt of tranches**, each locked until release, plus AI chat ("why is X blocked?") [C]
18. **Stood OpenAPI → APIMatic SDK** (+ MCP server if alpha access is granted) [C]
19. **Evidence agent on Astropods** (no PayPal credentials) and an **Elastic evidence index** (kNN reused / internet photos) [C]
20. **Kernel headless sandbox approval**: "Replay as Ama" for judges, plus CI [C]
21. **Zapier notifications**, outbound only (Ama, Kojo, reviewer) [C]
22. **Postman public workspace, fixtures collection and monitors** [C]

## Later

- Webhook retries and idempotency keys
- More checklists (lender site visit, insurance claim, NGO milestone, farm input delivery)
- Inspector and plot record, improved only by accepted visits from outside the inspector's tree
- Sandbox vs live keys, a multi-tenant platform model
- Device attestation (Play Integrity) via the capture SDK [C]
- Random double-inspection to catch collusion [C]
- Satellite / prior-imagery comparison [C]
- An AP2-compatible mandate export [C]

## Never in v1 [U]

Matching. Ratings. Cedi settlement. Catalog. Subscriptions. Chat. A map of Africa.
[C] Also never: holding funds, a token, referral bonuses for inspectors.
