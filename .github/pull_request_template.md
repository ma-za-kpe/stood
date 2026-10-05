<!-- PR title must be a Conventional Commit, e.g. `feat(decision): refuse changed frozen acceptance tests` -->

## Scope

What changed and why. Link the task: `TASKS.md#T-XXXX` and the spec doc(s).

## Tests first

- [ ] I wrote a failing test before the change (or this PR is docs / config only).
- [ ] Acceptance scenarios / fixtures affected: <!-- code-good · signed-tests-changed · tests-skipped · weak-tests · usage-pending; site-visit scenario fixtures if touched -->

## Evidence

- Tier reached: <!-- designed · implemented · unit-tested · contract-tested · deployed · demo-verified · field-tested -->
- [ ] `pre-commit run --all-files` is clean (no `--no-verify`).
- [ ] CI is green.
- [ ] Commands and results pasted below.

## Money safety

- [ ] No model / LLM code can reach the payments adapter or PayPal credentials.
- [ ] Every money-touching command is idempotent. No float money.
- [ ] Defaults fail closed (missing evidence → wait).
- [ ] No secrets, real identifiers or personal data in code, fixtures, logs or screenshots.

## Docs and voice

- [ ] Spec docs / ADRs / `TASKS.md` updated.
- [ ] User-facing copy matches `docs/stood/S06-voice-and-states.md` (no "escrow", "verified", "fraud", "Something went wrong").
