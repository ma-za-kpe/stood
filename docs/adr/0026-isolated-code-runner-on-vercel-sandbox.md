# ADR-0026: The isolated code runner runs on Vercel Sandbox

- Status: accepted
- Date: 2026-10-09
- Deciders: product owner (chose Vercel Sandbox, 2026-10-09) and engineer
- Tasks: T-0164 (isolated runner), T-0159 (trusted ingestion); unblocks the T-0189 follow-up (#77)

## Context

Code milestones (`code.milestone@1`, `code.final@1`) pay only when the buyer's frozen tests pass on the builder's exact commit. Stood already has the halves around the runner:

- `repositoryChecks` (T-0165) reads the repository at the exact commits: the frozen tests are present and unchanged, nothing else forbidden changed, and the commit is new and descends from the base.
- `SignedReportVerifier` (T-0171) accepts only an Ed25519-signed report bound to the platform, allowance, package, repository, base, commit, frozen test bundle, runner and image, recorded within five minutes, and turns it into rule checks.

What is missing is the part that **executes untrusted code**: the builder's repository, with the buyer's tests, producing a result Stood can trust. Executing it inside the payment API, the reconciler or any service holding keys is out of the question. Render cannot run privileged containers, nested virtualisation or gVisor, which rules out a self-hosted sandbox on our current hosting.

Options considered:

| Option | Isolation | Network control | Operations | Verdict |
| --- | --- | --- | --- | --- |
| **Vercel Sandbox** | Firecracker microVM per run | `deny-all`, domain allow-lists, changeable mid-session | Hosted API; nothing to patch | **Chosen** |
| E2B | Firecracker microVM per run | Coarser controls | Hosted API | Close second |
| Rootless Docker (+ gVisor) on a rented VM | Container (gVisor: user-space kernel) | iptables we maintain | We run, patch and monitor a VM | Most control, most work, slowest to qualify |
| `vm2`, `child_process`, `eval` in our services | None worth the name | None | None | Rejected: known escapes, shares our process and keys |

## Decision

A **runner worker** (outside the payment API) executes each queued package in a fresh **Vercel Sandbox** and signs the result; Stood ingests it through the existing verifier.

1. **One microVM per run.** `persistent: false`, `vcpus: 1`, a short session timeout, the managed `vercel/sandbox/node:24` image, `stop()` in `finally`. Nothing survives the run.
2. **No secrets inside.** The VM receives the repository at the exact commit and the buyer's frozen tests, nothing else: no Stood, PayPal, GitHub or Vercel credential. The worker fetches the source with its own read-only access and writes the files in.
3. **The buyer's tests win.** The frozen test bundle is written over the repository's test paths after the source, so a builder cannot change what is run; `repositoryChecks` separately fails a commit that changed them.
4. **Network in two phases.** Dependency install may reach only the package registry (domain allow-list). Before any test runs, the policy is switched to `deny-all` (`sandbox.update`), so the untrusted code under test has no network at all, not even DNS.
5. **Non-root, bounded.** Commands run as the sandbox's unprivileged user. Each command has its own time limit inside the session; a run that hits it is reported as failed tests, never as a pass.
6. **Signed outside the VM.** The worker reads the per-test results from the VM, computes the diff hash, and signs the report with the runner's Ed25519 key, which never enters the VM. The report carries `evidenceTier: "attested"` and the runner and image identities the verifier binds.
7. **Unavailable is a wait.** A runner or Vercel failure leaves the package queued (`waitingFor: RUNNER`); it never produces a pass, and never a refusal either.
8. **Ingestion (T-0159).** Verified checks, together with `repositoryChecks`, become the decision for the tranche through the existing decision rules, and only then can Stood capture or void. A report that fails verification yields no checks, so no decision.

## Consequences

- Untrusted code runs only in a disposable microVM with no credentials and, while tests run, no network.
- Running costs Vercel Sandbox compute per run (one vCPU, minutes); the team's spend limit caps it. The runner needs `VERCEL_TOKEN`, `VERCEL_TEAM_ID` and `VERCEL_PROJECT_ID` (a project made only for the runner) and its signing key; none of these enter the VM.
- Mutation testing (`mutation_score`) is optional in the code profiles; the first runner reports the score the contract requires as its floor only when a mutation tool is configured, and until then milestones should set `minMutation: 0`.
- Vercel becomes a dependency of code payments. If it is unavailable, code milestones wait; money never moves on a missing run.
- Qualification before shipping: a live run on the sandbox repository must pass and fail on real tests, and escape and resource cases must be shown contained (network denied during tests, a runaway process stopped by the time limit, no credentials visible inside).
