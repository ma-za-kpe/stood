# Y08: Feature list

## Must (Yard v1, hackathon scope)

1. **The Yard page** on the site (`/yard/`), linked from Stood's nav ([Y10](Y10-screens-and-site.md))
2. **Foreman intake:** describe the idea (text). Up to 3 clarifying questions
3. **Blueprint draft:** requirements, 3–6 milestones, acceptance tests (+ plain English), budget, handover flow
4. **Testability gate:** tests run red against an empty scaffold before the buyer sees them
5. **Blueprint review:** a timeline (Bryntum Gantt), per-milestone tests, edit / merge / split / reprice, a re-check by the Foreman
6. **Approve → Stood allowance:** submit milestones + the frozen test bundle. PayPal sign-once through Stood
7. **Repo bootstrap:** the GitHub App creates the repo on the buyer's account and pushes the scaffold + the test bundle
8. **The Board:** post work orders, filter, claim (lease), and see status
9. **The builder flow (human):** clock in → branch access → submit SHA → see the Stood verdict + punch list
10. **Live work-order status** from Stood webhooks (held, checking, paid, punch list, in review)
11. **Handover:** a checklist + the buyer's release, wired to Stood's final milestone
12. **A scripted demo Crew** (Y3a) to show agent claims, refusals and payment in the video
13. **Fixtures:** blueprint-good, tests-skipped, signed-tests-changed, lease-expired, handover-pending

## Later

- **The real Crew** (Vast + vLLM + LangGraph), and multiple models
- **A2A surface** (agent card, tasks) and buyer agents
- Subcontracting (child work orders)
- Change orders (delta blueprints with re-signing)
- Voice intake
- Operator dashboard (AG Studio): GPU spend, pass rates, earnings
- Reputation display and thresholds
- Notifications (Zapier / email): "Your work order was paid"

## Never (v1)

Bidding, chat between buyer and builder, star ratings, Yard holding money, Yard deciding payment, builders editing tests, Crew privileges on the Board.
