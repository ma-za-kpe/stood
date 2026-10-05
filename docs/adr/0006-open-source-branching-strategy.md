# ADR-0006: GitFlow branching, adapted for release-please

> Historical framing (before the 5 Oct 2026 repositioning). See [S17](../stood/S17-agent-payments-positioning.md).

- **Status:** accepted. **Supersedes [ADR-0002](0002-trunk-based-with-release-please.md)** (trunk-based).
- **Date:** 2026-10-03
- **Decider:** product owner (explicit request: `main → develop → feature`)

## Context and evidence

- The open-source "standard" is really two camps:
  - **GitFlow** (Driessen, 2010): `main`, `develop`, `feature/*`, `release/*`, `hotfix/*`.
  - **Trunk-based / GitHub Flow** with release branches: Kubernetes, Node.js and React use it.
- The product owner chose `main → develop → feature`, matching the speedo project.
- Constraint: **release-please** reads Conventional Commits on `main`.

## Decision

| Branch | Purpose | From → into | Merge method |
|---|---|---|---|
| `main` | Released state only. Every commit is deployable. Pages deploys from here | — | — |
| `develop` | **Default branch.** Integration of the next release | from `main` | — |
| `feature/*`, `fix/*`, `docs/*`, `chore/*`, `ci/*`, `build/*`, `refactor/*`, `test/*`, `perf/*`, `revert/*` | One change each, ≤ 3 days | from `develop` → `develop` | **Squash.** The PR title = one Conventional Commit |
| *promotion PR* `develop → main` | Ship the integrated work | `develop` → `main` | **Merge commit** (preserves the individual Conventional Commits for release-please) |
| `release-please--branches--main` (bot) | Version bump + CHANGELOG | bot → `main` | Squash (bot title) |
| `hotfix/*` | Urgent fix to released code | from `main` → `main`, then back-merged | Squash |
| *back-merge PR* `main → develop` | Bring release commits and hotfixes back | `main` → `develop` | **Merge commit**. Opened automatically by `back-merge.yml` |
| `release/vX.Y` | Only after 1.0.0, security backports | from a tag | Cherry-pick PRs labelled `backport` |
| `spike/*` | Throwaway exploration | from `develop` | **Never merged** |

The release-please release PR plays GitFlow's `release/*` role.

### Rules

- Rulesets protect `main` and `develop`:
  - PR required
  - required checks `pre-commit`, `pr-title` and `dco`
  - conversation resolution required
  - no force-push or deletion
  - `develop` allows squash (features) and merge commits (back-merges from `main`). Linear history isn't enforced, because back-merges are merge commits by design
- **DCO sign-off** on every human commit. Conventional-Commit PR titles.
- Only release-please creates `vX.Y.Z` tags.

## Alternatives considered

- Trunk-based (ADR-0002): simpler, but rejected by the product owner. GitFlow gives a stable `main` for the public site and the judges while `develop` moves fast.
- Classic GitFlow with manual `release/*` branches: replaced by the release-please release PR, to avoid long-lived divergence.

## Risks and controls

- **Bot PRs** (release-please, back-merge) are opened with `GITHUB_TOKEN`, so they don't trigger CI and required checks never report. The repository admin merges them via ruleset bypass. Each bypass is noted in the PR. Fix later with a GitHub App token.
- **Drift between `main` and `develop`:** the automatic back-merge PR after every push to `main`.
- **Solo maintainer:** required approvals are 0. Raise to 1 plus CODEOWNERS on the money path when a second maintainer joins.

## Reversal condition

If promotion and back-merge overhead exceeds its value (for example, more than two drift conflicts a month), return to trunk-based.
