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

## Amendment, 2026-10-10: what a PASS proves (external audit)

An external audit of the runner found that a PASS proved less than it claimed. Five things changed, and one limit remains for the owner to decide.

**Changed (T-0298 to T-0304):**

1. **A PASS needs real results.** Exit code 0 was the verdict. On Node 24 a test file that calls `process.exit(0)` before or during its assertions, or has no tests, exits 0. The runner now reads Node's TAP report and passes a file only on at least one real named result, all ok, none skipped, with matching counts.
2. **The code under test cannot change what judges it.** Point 5 above ("non-root") was true but not enough: the sandbox's default user (uid 1000) holds every Linux capability, so file permissions did not bind it. The workspace is now root-owned and read-only, and tests run through `setpriv` as `nobody` with every capability dropped, `no_new_privs` and an empty environment. A real write attempt as that identity must fail before any test runs.
3. **Unavailable is narrower than failed.** An install failure fails the tests only when npm names the submission as broken; a registry outage or rate limit waits (point 7).
4. **One run per job, latest package only.** Runs are claimed with a lease and back off when they wait. A decision is applied only while its package is still the tranche's latest, under the lock a submission takes.
5. **Image identity, honestly named.** The signed `imageDigest` is the SHA-256 of the image tag and SDK version, a label. Vercel's managed images are named by tag, so a report says which configuration ran, not exactly which bytes. The field keeps its name so stored reports still verify.

`scripts/dev runner-check` replays each attack on real Vercel Sandbox before the runner is trusted again.

**Owner decision, 2026-10-10: acceptance tests run out of process.** "Same-process tests are not evidence. Stood's whole claim is that the payee cannot write the proof alone." So (T-0305 to T-0309):

1. **Two identities in the VM.** The builder's code runs only as `nobody` (uid 65534) with no capabilities and `no_new_privs`, in `/vercel/run`. The frozen tests and Stood's harness run as the judge (uid 65533) from `/vercel/judge`. The judge cannot read the builder's code, so it cannot import it; the builder cannot write the tests, the harness or its own code, cannot signal the judge, and cannot read its memory or environment. Both are probed live before any test runs.
2. **Tests reach the code only as a process.** `runBuilder(argv, { input })` from `stood-harness` starts the builder's program as a separate process and returns its status and output. The Foreman writes tests in that form and refuses any test that imports anything else.
3. **Pass is the judge's process exiting 0** on the exact frozen files, whose bundle hash is in the allowance. Anything else is a refusal with the failed test named.
4. **Only the judge can make a code milestone payable.** Its decisions are `judge:<package>` and `judge-usage:<package>`, and it signs as `stood-vercel-sandbox-judge`. Settlement refuses to capture a code milestone whose release is anything else.
5. **Old releases are void for payment.** Every release recorded by the in-process runner (`run:` and `usage:` decisions) is refused by settlement and never replayed. `scripts/dev release-review` lists them, read-only, for the owner.

The judge's tests are trusted code (written by the Foreman, accepted by the buyer) and keep three capabilities (`setuid`, `setgid`, `setpcap`) only to start the builder's program as `nobody`.

**Second audit, 2026-10-11 (T-0315 to T-0322).** A process outcome is not business evidence, and a temporary failure is not a decision:

- A pass needs the judge's own report to show every test ran and passed; a skipped, cancelled or missing test fails.
- A baseline is red only on real assertion failures; a suite that cannot run at the base is `INVALID`.
- An unavailable repository leaves the package retryable; it never records a decision.
- The Foreman writes acceptance cases (data), and Yard renders the test file from one template.
- Leases carry an owner's token, are renewed while a run works, and end at an overall deadline; due jobs are chosen fairly in the database; worker counts are state changes.

Settlement stays off in production until the judge is merged, deployed and qualified live, and the owner has reviewed every release decision recorded while the old path existed. Step-by-step: [the Vercel Sandbox guide](../guides/vercel-sandbox-untrusted-code-judge.md).
