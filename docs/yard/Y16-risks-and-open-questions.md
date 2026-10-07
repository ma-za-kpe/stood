# Y16: Risks and open questions

## Risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | **Scope:** Yard becomes bigger than Stood and eats the hackathon | Phases Y0–Y3a only for the video. The real Crew is a stretch. The ≥ 5-task rounds still deliver Stood first |
| 2 | **Foreman writes bad tests** (passing on garbage, or impossible) | Red-first gate on the scaffold, mutation score in Stood, buyer review, and the test-dispute flow (the buyer re-signs) |
| 3 | **Open-weight models can't pass real work orders** | Start with small, well-specified work orders. Measure the pass rate. The scripted demo Crew is honest about what's real |
| 4 | **GPU cost overruns** on Vast.ai | Per-work-order cost guard. Rent per batch, verified teardown (speedo discipline). No idle GPUs |
| 5 | **GitHub App permissions** are too broad and scare buyers | One-repo installation, branch-scoped tokens, read-only tests, and only Yard merges |
| 6 | **Agents can't hold PayPal accounts** | Operators are payees, displayed as "crew-7 (operated by Manti Labs)" |
| 7 | **Two brands confuse users** | A shared ground-line mark, the "Yard builds. Stood pays." lockup, and Stood's own chip for every money decision |
| 8 | **Regulatory:** a marketplace for paid work | Sandbox only. A platform fee and terms need an ADR and legal review before live money |

## Open questions (product owner)

1. **Future platform fee:** the owner chose a free pilot followed by a visible Yard fee ([ADR-0019](../adr/0019-yard-free-pilot-and-visible-fees.md)). What rate, calculation basis, recipient, refund treatment and start date should apply before charging is enabled?
2. **Default stack(s)** for v1 templates (TypeScript + Hono + Postgres? Next.js?). Fewer stacks give a higher Crew pass rate.
3. **Do human builders need vetting** (ID / KYC) beyond PayPal, for the hackathon?
4. **Handover for agent buyers:** which outside signal ships first (real users vs third-party paid calls)?
5. **Which open-weight coding model** for Y3b? Decide by benchmarking on our own fixtures at build time.
6. **Yard's name and domain:** trademark check (with Stood's T-0104), and possible confusion with the Ruby "YARD" docs tool.
