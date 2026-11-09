# Develocity 2026.3: fit and no-cost measurement plan

## Decision

Do not add a Develocity agent, account, CI secret, or service dependency to Stood now. The 2026.3 release adds useful Docker build scans, including per-step timing, cache usage, failures, and organization-level Docker cache analytics. However, Docker support must be enabled by Develocity support and sends scans to a Develocity instance ([Docker docs](https://docs.develocity.ai/docker/0.9/), [2026.3 release](https://develocity.ai/releases/2026.3)).

The no-cost Build Scan service is for Gradle, Maven, and sbt builds, while this repository uses pnpm, Turborepo, and Docker ([Build Scan](https://develocity.ai/scans/gradle/)). The npm agent requires a Develocity server, its documented integration is for npm, and publishing to the public `develocity.ai` service is unsupported ([npm agent setup](https://docs.develocity.ai/npm/4.1/npm-agent/)). A Develocity subscription is priced per committer per year ([pricing](https://develocity.ai/pricing/)); its full-product trial lasts up to 30 days after the first builds connect ([trial terms](https://develocity.ai/trial/)). Neither is a continuing zero-cost option. Develocity's free OSS instances are sponsorships for selected projects, not an automatic free tier ([OSS sponsorship](https://develocity.ai/oss-sponsored-by-develocity/)).

Revisit integration only if Develocity confirms in writing that Stood qualifies for a sponsored instance, enables Docker support on that instance, and confirms a supported route for this pnpm/Turborepo workflow. Do not add a Gradle build solely to emit free scans; that would measure an unrelated build and distort the signal.

## Measure progress at no added cost

Use the existing GitHub Actions `ci` workflow and `scripts/ci-local`; do not treat one slow run or a local run on different hardware as a regression.

1. Capture the next 20 consecutive successful `ci` runs on `develop` as the baseline. For each run, record the commit, workflow URL, total wall time, each job's duration, conclusion, and any reruns. Exclude cancelled runs and tag exceptional runs (provider outage, GitHub incident, or unrelated concurrency) rather than silently dropping them.
2. After a build or CI change, capture the next 20 comparable runs using the same runner class and workflow. Compare median and P90 total duration and per-job duration; compare failure rate and reruns per 20 runs. Report the sample size and excluded incidents with each comparison.
3. For Docker changes, record cold and warm `docker compose build app` wall times on the same host, Docker/BuildKit versions, and whether the build was cold or warm. Use the build output to identify cache hits. Do not claim a per-layer hit rate unless the build tool reports one.
4. Keep the raw run URLs and a dated summary in the relevant task/PR. A speed improvement is only accepted when the same tests and checks still pass; track reliability separately from duration.

GitHub Actions run history can be queried without another paid service using `gh run list --workflow ci.yml --branch develop --limit 20`. `scripts/ci-local` remains the full local regression gate, not a substitute for comparable hosted-runner timings.

## Sources checked

- [Develocity 2026.3 release notes](https://develocity.ai/releases/2026.3)
- [Develocity Docker agent 0.9 documentation](https://docs.develocity.ai/docker/0.9/)
- [Develocity npm agent documentation](https://docs.develocity.ai/npm/4.1/npm-agent/)
- [Build Scan availability](https://develocity.ai/scans/gradle/)
- [Pricing](https://develocity.ai/pricing/), [trial](https://develocity.ai/trial/), and [OSS sponsorship](https://develocity.ai/oss-sponsored-by-develocity/)
