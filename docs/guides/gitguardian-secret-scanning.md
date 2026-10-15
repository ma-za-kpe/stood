# GitGuardian: scan the commits before pushing

Stood uses GitGuardian's `ggshield` in the pre-push hook to scan every commit not yet on `main`. It also runs a local detector for values that look like secrets even when they are fake. GitGuardian can report a credential that was committed and later removed because the earlier commit remains in the PR history.

## Set it up and run it

1. Create a GitGuardian personal access token with the `scan` scope at the [GitGuardian dashboard](https://dashboard.gitguardian.com/). Do not use a token with broader permissions.
2. Add `GITGUARDIAN_API_KEY` only to your private `.env` (mode 600) or shell secret store. It does not belong in `.env.example`, GitHub comments or screenshots.
3. Run `pre-commit install --hook-type pre-push`, then run `pre-commit run --hook-stage pre-push ggshield` before pushing. The hook itself uses `ggshield secret scan commit-range <merge-base>..HEAD` and obtains the API key from the environment or `.env` without printing it.
4. Run the local secret-shape check with `python3 tools/no-realistic-secrets/check.py <changed-file>` (normally pre-commit runs it automatically).

The project pins `ggshield==1.55.0` in `.pre-commit-config.yaml`. GitGuardian documents [ggshield](https://docs.gitguardian.com/ggshield-docs) and [personal access tokens](https://docs.gitguardian.com/api-docs/personal_access_tokens). Check the current plan and scan limits in the dashboard; this guide does not promise a free quota.

## Findings and recovery

Stop before pushing if the scan fails. If a real credential was exposed, revoke/rotate it at its issuing service first; deleting the line from the latest commit is insufficient. Follow the repository's incident and history-rewrite policy. Do not paste the detected value into an issue. A generic false positive can be reviewed using GitGuardian's fingerprint and source location, but never suppress a detector by adding a plausible-looking fake secret to the repository.

In CI, the local pre-push hook reports that it is skipped because the installed GitGuardian GitHub integration scans pull requests. This does not mean the PR is unscanned unless that GitHub integration has been confirmed. Local tests validate the custom detector; only a successful `ggshield` invocation with a configured token is live GitGuardian evidence.
