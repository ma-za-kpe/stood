# OpenSSF Best Practices badge: prepared answers

The [OpenSSF Best Practices badge](https://www.bestpractices.dev/) (formerly CII) is one of the OpenSSF Scorecard checks. Only the repository owner can register a project, so this page holds the answers for the **passing** level with the evidence for each, ready to paste. Register at <https://www.bestpractices.dev/en/projects/new> with `https://github.com/ma-za-kpe/stood`, then add the badge to the README.

Every answer below is **Met** unless it says otherwise. Links are relative to the repository root.

## Basics

| Criterion | Answer and evidence |
| --- | --- |
| description_good | [`README.md`](../../README.md) says what Stood does and who it is for. |
| interact | Issues and PRs on GitHub; [`CONTRIBUTING.md`](../../CONTRIBUTING.md). |
| contribution | [`CONTRIBUTING.md`](../../CONTRIBUTING.md): fork, branch `<type>/<issue>-<slug>`, failing test first, small PRs. |
| contribution_requirements | [`docs/WAYS_OF_WORKING.md`](../WAYS_OF_WORKING.md): Conventional Commits, DCO sign-off, coverage floors, review rules. |
| floss_license / license_location | MIT, in [`LICENSE`](../../LICENSE). |
| documentation_basics | [`README.md`](../../README.md) install guide, [`docs/SETUP.md`](../SETUP.md), [`docs/USAGE.md`](../USAGE.md). |
| documentation_interface | API contract in [`docs/tech/T04-api-spec.md`](../tech/T04-api-spec.md). |
| sites_https | GitHub, GitHub Pages and the Render API are HTTPS only. |
| discussion | GitHub issues and pull requests are public, searchable and linkable. |
| english | Yes. |
| maintained | Yes (active daily). |

## Change control

| Criterion | Answer and evidence |
| --- | --- |
| repo_public / repo_track / repo_interim | Public Git on GitHub; every change is a commit or PR, including work between releases. |
| repo_distributed | Git. |
| version_unique / version_semver | release-please tags SemVer versions ([`release-please-config.json`](../../release-please-config.json)). |
| version_tags | Each release is a Git tag. |
| release_notes | [`CHANGELOG.md`](../../CHANGELOG.md), written from Conventional Commits. |
| release_notes_vulns | Vulnerability fixes appear under **Fixes** in the changelog and link their GitHub advisory (`/security/advisories`). None so far. |

## Reporting

| Criterion | Answer and evidence |
| --- | --- |
| report_process / report_tracker | GitHub issue forms ([`.github/ISSUE_TEMPLATE`](../../.github/ISSUE_TEMPLATE)). |
| report_responses / enhancement_responses | The maintainer answers issues; the project is young, so the 12-month record is short but complete. |
| report_archive | GitHub issues are public and permanent. |
| vulnerability_report_process | [`SECURITY.md`](../../SECURITY.md). |
| vulnerability_report_private | GitHub private vulnerability reporting is enabled (`/security/advisories/new`). |
| vulnerability_report_response | Acknowledge within 72 hours (the criterion asks for 14 days). |

## Quality

| Criterion | Answer and evidence |
| --- | --- |
| build / build_common_tools | `pnpm install && pnpm build` (pnpm, Turborepo, TypeScript); Docker dev in [`docs/tech/T15-docker-and-local-dev.md`](../tech/T15-docker-and-local-dev.md). |
| build_floss_tools | Every build tool is open source. |
| test / test_invocation | Vitest, `pnpm test`; documented in [`docs/tech/T12-testing-and-quality.md`](../tech/T12-testing-and-quality.md). |
| test_most | Coverage floor 85% overall and 100% on the money domain, enforced in CI and the pre-push gate. |
| test_continuous_integration | [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) on every PR. |
| test_policy / tests_are_added / tests_documented_added | Test-first is required ([`docs/WAYS_OF_WORKING.md`](../WAYS_OF_WORKING.md)); each task records its failing test in [`TASKS.md`](../../TASKS.md). |
| warnings / warnings_fixed / warnings_strict | TypeScript `strict`, Biome lint as errors, ruff, shellcheck, actionlint and zizmor in pre-commit and CI. |

## Security

| Criterion | Answer and evidence |
| --- | --- |
| know_secure_design / know_common_errors | [`docs/tech/T11-security-privacy.md`](../tech/T11-security-privacy.md): threat model, money boundary enforced by dependency-cruiser, secrets policy. |
| crypto_published / crypto_call | Stood implements no cryptography; it uses TLS (Node, Postgres `sslmode=verify-full`) and PayPal's signature verification API. |
| crypto_floss / crypto_keylength / crypto_working / crypto_weaknesses / crypto_pfs / crypto_password_storage / crypto_random | N/A: no project-implemented crypto and no stored passwords. |
| delivery_mitm / delivery_unsigned | Code and releases come from GitHub over HTTPS; dependencies are lockfile and hash pinned. |
| vulnerabilities_fixed_60_days / vulnerabilities_critical_fixed | Dependabot, OSV-Scanner and dependency review run on every PR; none open. |
| no_leaked_credentials | gitleaks, GitGuardian, `detect-private-key` and the project's own no-local-secrets hook; a full-history scan found none. |

## Analysis

| Criterion | Answer and evidence |
| --- | --- |
| static_analysis / static_analysis_common_vulnerabilities / static_analysis_fixed / static_analysis_often | CodeQL ([`.github/workflows/codeql.yml`](../../.github/workflows/codeql.yml)) on every PR and weekly, plus Biome and OpenSSF Scorecard. |
| dynamic_analysis | Met: the mock network runs the whole system end to end against PayPal and partner simulators (`scripts/mock-network`), and a nightly job runs real PayPal sandbox payments. |
| dynamic_analysis_unsafe | N/A: TypeScript is memory-safe. |
| dynamic_analysis_enable_assertions / dynamic_analysis_fixed | Assertions are on in all tests; failures block the merge. |
