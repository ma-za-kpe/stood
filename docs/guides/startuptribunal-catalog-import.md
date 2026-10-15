# StartupTribunal: import a public idea into a private Yard brief

Yard reads the public StartupTribunal catalog to help a buyer start a project brief. The catalog is discovery material, not proof that an idea is safe, accurate, approved or ready to build. Yard preserves attribution and tribunal decision text, then requires the buyer to review the resulting private brief before planning.

## Use the import

1. Open hosted Yard and sign in with a buyer access code.
2. Browse or search the public idea cards. Choose **View idea** to inspect the full source and decision before importing.
3. Select **Use this idea in a private intake**. Review the summary and source attribution; edit details before asking the Foreman to plan.
4. Reload the saved intake to confirm the brief is private and persisted. Do not paste a real person's private information into a public catalog idea.

The service calls the fixed public endpoint `https://startuptribunal.com/api/public/ideas?limit=10`, follows no redirects, sends no credentials, limits the response body to 64 KiB and validates the payload. It caches successful reads for ten minutes and backs off on errors or rate limits. These are implementation safeguards in [`TribunalCatalog`](../../services/yard-api/src/adapters/tribunal-catalog.ts), not a guarantee of StartupTribunal availability.

## Test and troubleshoot

Run `corepack pnpm exec vitest run services/yard-api/src/adapters/tribunal-catalog.test.ts apps/yard-web/src/IntakePanel.test.tsx`. The tests use a fake HTTP response, so they prove URL, parsing, caching, size and retry rules without claiming a live catalog result. For a live check, open the Yard page and confirm the source link is from `startuptribunal.com`; if the feed is unavailable, Yard reports discovery unavailable rather than inventing cached content.

The public catalog is currently read without an API key. Do not add a credential unless StartupTribunal publishes a supported authentication method and the implementation is reviewed. Usage limits and service terms belong to StartupTribunal; check its current [site and terms](https://startuptribunal.com/) before building a high-volume importer. Import does not create a Board project, sign an allowance or authorize a payment.
