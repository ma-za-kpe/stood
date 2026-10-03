# ADR-0002: Trunk-based flow with release-please

- **Status:** accepted
- **Date:** 2026-10-03

## Context and evidence

speedo uses `main` + `develop` with promotion PRs. Stood is a 5.5-week hackathon build with one integrator. release-please releases from the default branch and reads Conventional Commits.

## Decision

`main` is the only long-lived, protected branch. Work goes on short-lived `type/description` branches and is squash-merged with a Conventional-Commit PR title. release-please keeps a release PR open on `main`. Merging it tags `vX.Y.Z`, updates `CHANGELOG.md` and creates a GitHub Release. Versioning is SemVer from `0.1.0`.

## Alternatives considered

- `develop` + `main` (speedo's model): deferred. It adds a promotion step we don't need yet.
- Manual tags and a hand-written changelog: rejected. They're error-prone, and the changelog drifts.

## Risks and controls

- Bad PR titles → a Conventional-Commit check runs at `commit-msg` locally and on PR titles in CI.
- An accidental push to `main` → branch protection plus the pre-commit `no-commit-to-branch` hook.

## Reversal condition

More than two regular contributors, or a staged environment that needs an integration branch.
