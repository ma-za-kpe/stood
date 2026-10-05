# Yard test providers

**Synthetic results only. No payment is executed.** These implementations stay under `test/fakes/`, outside the production build and behind the import boundary.

- `stood.ts` serves the existing code-milestone SDK draft/package surface with fixed `sim-stood-key` / `sim-stood-secret` credentials. Signed synthetic outcomes use `sim-stood-webhook-secret`. It runs over actual loopback HTTP in the contract tests, without a database or PayPal. It covers current SDK methods, not the future financial API or Yard's unimplemented payment projection.
- `github.ts` implements the repository port independently in memory. Synthetic one-hour tokens are bound to one repository and builders to one work-order branch. Protected paths and compare-and-swap operations fail closed. Its fixture JSON archive and SHA-shaped identifiers are not real Git objects or GitHub HTTP protocol evidence. The eventual adapter must preserve the same port restrictions and pass these attack cases; SDK/wire qualification remains open.

Only a maintainer token may merge. The Yard orchestrator must separately authenticate Stood's confirmed release before invoking a real merge; the repository provider itself has no payment authority. Token scoping is informed by [GitHub's installation-token documentation](https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app); the fake does not claim it can enforce every branch restriction through raw GitHub token permissions alone.
