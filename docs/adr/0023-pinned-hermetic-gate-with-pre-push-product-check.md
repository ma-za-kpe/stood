# ADR-0023: A pinned, hermetic local gate, with the product check at pre-push

- **Status:** accepted
- **Date:** 2026-10-08
- **Deciders:** product owner and engineer (issue #74, T-0247)

## Context and evidence

The pre-commit gate ([WoW §8](../WAYS_OF_WORKING.md#8-validation-before-commit-pre-commit-is-cutthroat)) is broad, and CI runs the same config on every pull request. A review against common practice in large open-source projects found five gaps:

1. External hooks were pinned to **tags**. A tag can be moved to different code; a commit SHA cannot. The repository already pins GitHub Actions to full SHAs (WoW §11), so the gate itself was the weaker link.
2. Seven critical shell scripts (`scripts/dev`, `mock-network`, `check-product`, …) had no linter. The new Python tool (`tools/paypal-mcp-token`) had none either.
3. Biome and markdownlint ran through the host's `npx`, so results depended on the machine's Node and npm. Switching them to pre-commit's `node` language failed on npm 11.11.0 (`EALLOWGIT`: npm refuses to install the hook repository from git), so node hooks are not hermetic here either.
4. The Docker product gate (lint, strict types, boundaries, all tests with coverage, build, Postgres tests) ran on **every commit** and takes several minutes, which encourages large commits instead of small ones.
5. Nothing kept hook versions current.

## Decision

- Every external hook `rev` is a **full commit SHA** with the tag in a `# frozen:` comment.
- Add **shellcheck** (shell scripts) and **ruff** check and format (Python tools). Both passed or were fixed on every file at adoption.
- Run Biome and markdownlint from **digest-pinned container images** (`language: docker_image`). Docker is already required for development, so this adds no new prerequisite. markdownlint runs serially because `--fix` rewrites files.
- Move `product-validation` to the **`pre-push`** stage. `pre-commit install` now installs `pre-commit`, `commit-msg` and `pre-push` hooks. CI runs **both** stages on every pull request (`pre-commit run --all-files` and `--hook-stage pre-push`), so nothing reaches `develop` or `main` without the full product gate.
- **Dependabot** opens a monthly update pull request for hook versions (`package-ecosystem: pre-commit`), alongside the existing npm and GitHub Actions updates.

## Alternatives considered

- **Keep the product gate at commit time:** strongest local feedback, but minutes per commit; rejected because CI already enforces it on every pull request and pushes still run it locally.
- **pre-commit.ci for autoupdates:** an extra third-party service with write access; Dependabot is already trusted here.
- **Node-language hooks for Biome and markdownlint:** the standard choice, but they fail on current npm in this environment (evidence above).
- **Tags with periodic manual review:** weaker than SHAs for no gain.

## Risks and controls

- A commit can now land locally without the product gate. Control: the `pre-push` hook and the required CI checks; `--no-verify` remains forbidden.
- Image digests and SHAs go stale. Control: the monthly Dependabot pull request; the tag comments keep updates readable.
- Container hooks need Docker running. Control: Docker is already a stated prerequisite (README installation guide).

## Reversal condition

Revisit if CI stops running the `pre-push` stage, if Dependabot's pre-commit support stops working, or if a hermetic node-language hook becomes reliable with the npm versions contributors use.
