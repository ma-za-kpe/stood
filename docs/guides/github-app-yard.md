# GitHub App: let Yard work in one sandbox repository

Yard uses an installation-scoped GitHub App for repository reads and the work-order branch/PR workflow. It avoids a developer's broad personal token. Yard additionally enforces one allow-listed repository, short-lived grants, `wo/*` branches, protected acceptance tests and non-forced fast-forward updates through an open pull request.

## Create and install the app

1. In GitHub **Settings → Developer settings → GitHub Apps**, create an app for the Yard sandbox.
2. Set repository permissions to the minimum required by the feature: Contents read/write, Pull requests read/write, Metadata read. Do not request organization administration or account permissions. Configure the callback/webhook only when using the corresponding hosted feature.
3. Generate the private key and store it outside the repository with mode 600, for example `~/.config/stood/yard-github-app.pem`. Do not put the PEM in `.env`, a PR or a screenshot; `.env` contains the file path locally and the hosted service receives the key through its private environment configuration.
4. Install the app on only `ma-za-kpe/yard-sandbox`. Record the numeric App id and installation id in private environment settings and set `YARD_SANDBOX_REPOSITORY=ma-za-kpe/yard-sandbox`.
5. Run `scripts/dev github-check` using the configured test repository. Confirm the command sees only the allowed repository. Then run the repository adapter tests: `corepack pnpm exec vitest run services/yard-api/src/adapters/github/github.test.ts`.

GitHub explains [App permissions](https://docs.github.com/en/apps/creating-github-apps/setting-up-a-github-app/choosing-permissions-for-a-github-app) and [installation access tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/creating-installation-access-tokens-for-a-github-app). Yard's installation tokens are limited to the one repository and the requested permission and expire within an hour. GitHub may charge for private repository or Actions usage according to the account plan; check [current pricing](https://github.com/pricing).

## Safety and troubleshooting

- `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`, and the key must refer to the same app installation. The app key is a secret; the two numeric ids are identifiers, not credentials.
- A 404 can mean the app is not installed on the repository; a 403 means permissions or installation scope are insufficient. Do not widen access to “all repositories” to silence an error.
- Yard refuses repositories outside its configured allow-list even when GitHub would allow access.
- `scripts/dev github-check` reaches GitHub and can read or exercise sandbox branch/PR operations. Never point it at a production repository.

Unit tests use a scripted GitHub API, not live GitHub. A live app test must be run explicitly with the disposable sandbox repository and recorded separately from these local checks.
