# Contributing to Stood

Thanks for helping. Stood decides whether someone's money moves, so we work carefully.

1. Read **[docs/WAYS_OF_WORKING.md](docs/WAYS_OF_WORKING.md)**: TDD, DDD, branches, commits, Definition of Done.
2. **Install pre-commit (mandatory):** `pip install pre-commit && pre-commit install`, then confirm `.git/hooks/pre-commit`, `.git/hooks/commit-msg` and `.git/hooks/pre-push` exist. Docker must be running: some hooks use pinned containers, and the product gate runs before every push. CI runs the same gate, so a skipped hook just fails your PR.
3. Open or pick an issue. **Fork**, then branch as `<type>/<issue>-<slug>` (for example `feature/42-hold-timers`).
4. Write the failing test first. Keep PRs small.
5. **Sign off every commit** (`git commit -s`, the [DCO](https://developercertificate.org/)). Forgot? Run `git rebase --signoff develop` and force-push your own feature branch with `--force-with-lease`.
6. Give the PR a Conventional-Commit title (`feat(decision): …`). It's squash-merged, and release-please handles versions and the changelog.

By contributing you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). Security issues: see [SECURITY.md](SECURITY.md).
7. Never commit secrets, real coordinates, faces, phone numbers or account identifiers.

Design-phase contributions (docs, research, field knowledge from Ghana, Nigeria, Kenya or Uganda) are very welcome. Open an issue.
