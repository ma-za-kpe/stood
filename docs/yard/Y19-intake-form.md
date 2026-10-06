# Y19: The intake form

The Foreman can only draw a good blueprint, and a builder can only ship a working product, if Yard knows **everything the project needs to run**. That includes the boring parts: which database, which auth provider, which cloud, which email sender, and the keys to reach them.

This doc defines the full intake: what we ask, **when** we ask it, **why**, and how every credential is handled. It pairs with [Y20](Y20-hosting-and-credentials-decision.md), which decides where things run and who holds production keys.

## 1. Principles

1. **Choices before keys.** Integrations are chosen during intake, because they change the blueprint and the price. **Credentials are asked for only after the buyer signs**, and only for the milestone that needs them.
2. **Test keys only, by default.** Yard builds and previews against **test / sandbox / dev-project** credentials. Production secrets go **straight into the buyer's own hosting** at handover (Y20). Yard refuses obviously live keys (for example `sk_live_`, or PayPal live client ids).
3. **Connect beats paste.** Prefer, in this order:
   - OAuth "connect" or an app install (GitHub App, Supabase OAuth)
   - keyless federation (GitHub OIDC → AWS role, GCP Workload Identity Federation, Azure federated credentials)
   - a pasted, **scoped** key
4. **Every field says why.** Each question shows a one-line "Why we ask" and "Who sees it".
5. **Models never see secrets.** The Foreman and the Crew see only that `SUPABASE_URL` *exists* and which provider it's for. Values are injected at deploy time, never into prompts, logs, events or the build sandbox.
6. **Autosave, resumable, honest.** Every step autosaves (`intake.saved`, [Y18](Y18-realtime-state-management.md)). The buyer can leave and come back. Unknown is a valid answer ("Not sure: let the Foreman pick").

## 2. The steps

The form is a **wizard driven by an XState machine** ([Y18](Y18-realtime-state-management.md) §4). The Foreman reads each step and may ask up to 3 follow-ups. Steps 1–8 happen **before** signing. Step 9 happens **after**.

### Step 1: The idea

| Field | Type | Why we ask |
|---|---|---|
| What are we building? | Long text (voice later) | The Foreman's main input |
| Who uses it? | Chips + text (customers, staff, admins, partners) | Roles become auth rules and tests |
| The one flow that proves it works | Text ("A customer books a slot and pays a deposit") | Becomes the **handover test**: the last payment releases on it |
| Anything like it you like? | URLs (optional) | Reference for scope, never scraped for code |
| Existing assets | Repo URL, Figma link, brand files, copy (optional) | Avoid rebuilding what exists |

### Step 2: Users, scale, places

| Field | Type | Why |
|---|---|---|
| Platforms | Web · mobile web (PWA) · iOS · Android · API only | Changes the stack and the milestones |
| Countries / currencies / languages | Multi-select | Payments, SMS providers, i18n, data residency |
| Expected users in month 1 / month 12 | Ranges | Picks the hosting tier and the database plan |
| Accessibility needs | Checkboxes (WCAG AA default) | Becomes tests |
| Offline / low bandwidth | Yes / no | Common in our first markets. Changes architecture |

### Step 3: Features

Pick from chips. Each chip expands into 1–3 questions.

| Chip | Follow-ups |
|---|---|
| Sign-in | Email / phone OTP / Google / Apple · roles · who can invite |
| Payments in the app | Provider (PayPal, Stripe, Paystack, Flutterwave, M-Pesa) · one-off / subscriptions / deposits · currencies. *(These are the app's own customer payments, separate from how Yard pays builders through Stood)* |
| Bookings / scheduling | Time zones · capacity · reminders |
| Notifications | Email / SMS / WhatsApp / push |
| File uploads | Types · max size · who can see them |
| Admin dashboard | Who uses it · what they edit |
| Search | Simple filter or full-text |
| Maps / location | Provider |
| AI features | What for · which provider · spend limit |
| Analytics | Provider · cookie consent needed? |
| Other | Free text |

### Step 4: Data

| Field | Why |
|---|---|
| What data is stored (people, money, health, children, location, documents) | Security level and tests |
| Personal data? Which country's rules apply (GDPR, NDPR, POPIA, Kenya DPA…) | Region choice, consent screens, deletion flows |
| Data residency requirement | Region pinning for the database and storage |
| Existing data to import (CSV, another database) | A migration milestone |
| Backups and retention | Hosting plan and a test |

### Step 5: Stack preferences

| Option | Meaning |
|---|---|
| **Let the Foreman pick** (default) | A boring, well-supported stack that fits the answers and hosts on Render |
| I have preferences | Language, framework, database, hosting (chips) |
| I have an existing repo | Import: Yard installs its GitHub App on that repo, and the Foreman reads its structure (no secrets) |
| Must run on my company's cloud | AWS / GCP / Azure. Changes the handover milestone (Y20 option C path) |

### Step 6: Integrations and services

One row per service the product will use. The buyer picks **which** service. Credentials come later (step 9).

| Category | Common choices |
|---|---|
| Backend platform | **Supabase**, **Firebase**, plain Postgres (Neon / Render Postgres) |
| Auth | Supabase Auth, Firebase Auth, Clerk, Auth0, built-in |
| Database | Supabase Postgres, Firestore, Neon, Render Postgres, MongoDB Atlas |
| File storage | Supabase Storage, Firebase Storage, AWS S3, Google Cloud Storage, Cloudinary |
| Cloud | **AWS**, **Google Cloud**, Azure, none |
| Email | Resend, Postmark, SendGrid, Amazon SES |
| SMS / WhatsApp | Twilio, Africa's Talking, Termii, WhatsApp Cloud API |
| Payments | PayPal, Stripe, Paystack, Flutterwave |
| Maps | Google Maps, Mapbox, OpenStreetMap |
| AI APIs | OpenAI, Anthropic, Google, open-weight (self-hosted) |
| Domain / DNS | Registrar name only. We never ask for registrar logins |
| Monitoring | Sentry, Better Stack, none |

### Step 7: Budget and timing

| Field | Why |
|---|---|
| Total budget (cap) | Becomes the Stood allowance cap |
| Deadline | Milestone deadlines. The hold window is at most 29 days per milestone, so long projects get more milestones |
| Pace preference | "Fewer, bigger milestones" vs "smaller, frequent" |
| Who signs off at handover | Name + email (it can be the buyer's agent for intermediate milestones, but **a human** for the handover) |

### Step 8: Ownership and handover

| Field | Default | Why |
|---|---|---|
| GitHub account or org the repo lives in | The buyer's | The code is the buyer's from the first commit (Y20) |
| Where production should run | "My own Render account" | Y20. Options: Render (one-click), my AWS / GCP / Azure, I'll decide later |
| Custom domain | Optional | DNS records are given at handover |
| Licence | Proprietary (buyer owns) | Or an OSI licence if they want it open |
| Who maintains it after | Me / my developer / a Yard work order later | Shapes the handover docs milestone |
| Consent | "Agents and human builders may build this. Code is visible to the assigned builder only" | Required |

### Step 9: Accounts and access (after signing)

Shown per milestone, only when that milestone needs it. A milestone that needs a key it doesn't have stays `POSTED`, with a buyer task "Connect Supabase (test project)". It isn't claimable until then.

## 3. The credentials matrix

| Provider | What Yard needs during the build | Preferred way | Acceptable fallback | **Never** ask for |
|---|---|---|---|---|
| **GitHub** | Create the repo, give builders branch access, merge on RELEASE | **GitHub App** installed on the buyer's account, selected repo only | None | Personal access tokens, passwords |
| **Supabase** | A **dev** project: URL, anon key (public), service-role key for dev only | Supabase OAuth (Management API) to create a dedicated dev project or branch | Paste URL + keys of a **separate dev project** | The production project's service-role key, the account password |
| **Firebase** | A **separate dev Firebase project**: the web config (public, not a secret) + a service account limited to that project | Buyer creates the dev project; Yard gives step-by-step with screenshots | Service-account JSON for the dev project, minimal roles | Production service accounts, Owner role |
| **Google Cloud** | Deploy to a **dev project** | **Workload Identity Federation** trusting the repo's GitHub Actions (no key file) | A service-account key, dev project only, least-privilege roles, expiry noted | Org-level roles, Owner, keys for the production project |
| **AWS** | Deploy to a **dev account** or sandbox | **IAM role assumed via GitHub OIDC**, trust policy pinned to the repo + branch | An IAM user access key with a scoped policy, rotated at handover | Root keys, `AdministratorAccess` on production |
| **Azure** | Deploy to a dev subscription / resource group | Federated credential for GitHub Actions | Service principal secret scoped to one resource group | Subscription Owner |
| **Payments (PayPal / Stripe / Paystack…)** | Sandbox / test keys | Paste test keys | None | **Live keys**: refused by pattern, entered by the buyer in their hosting at handover |
| **Email / SMS** | Test credentials, sandbox senders | Paste a key scoped to sending only | None | Account owner logins |
| **AI APIs** | A **project-scoped** key with a **spend limit** | Paste | None | Organisation admin keys |
| **Domain / DNS** | Nothing | Yard shows the records to add | None | Registrar login |
| **Render** | Nothing from the buyer during the build. Previews run in **Yard's** Render workspace (Y20) | — | — | — |

**What every builder (human or Crew) sees:** env var **names** and a `.env.example`. Tests run against **emulators and fakes** (Firebase Emulator Suite, Supabase local, LocalStack, provider sandboxes), so the build sandbox needs no secrets at all. The deployed **preview** gets the test keys, injected by Yard at deploy time.

## 4. How Yard stores the keys it does take

| Rule | Detail |
|---|---|
| Encrypted at rest | Envelope encryption: a per-blueprint data key, wrapped by a KMS key that `yard-api` can use but can't export. Ciphertext in Postgres (`yard.secrets`) |
| Write-only API | `PUT /blueprints/{id}/secrets/{name}` stores. There is **no GET of a value**. The UI shows provider, name, environment, a fingerprint, "added by", and validity |
| Validated, then minimised | On save, a harmless check: AWS `sts:GetCallerIdentity`, a Supabase health call, a Firebase project read. Yard **warns** if the credential looks broader than needed (admin role, live mode) |
| Used in one place only | Decrypted only by the preview-deploy job, sent straight to the preview service's env vars (Render API), then dropped from memory |
| Never | In Git, in logs, in Yard events (only `secret.added` with the name), in model prompts, in the build sandbox, in a site log, in screenshots |
| Expiry | Auto-deleted **7 days after handover** or on cancel. The buyer can revoke any time (revoking stops previews) |
| Audit | Every decrypt is an audit row: who, when, which deploy |

```text
yard.secrets (id, blueprint_id, provider, name, environment TEST|DEV, ciphertext, wrapped_dek,
              kek_id, fingerprint, created_by, created_at, validated_at, revoked_at, expires_at)
```

`environment` has no `PROD` value. That's on purpose.

## 5. The form, in the design system

- **Secret field** component (Y17 §5): masked, write-only, a "Why we ask / Who sees it" disclosure, a "Test connection" button, the states empty → validating → valid / invalid → revoked.
- A progress rail across the 9 steps. Steps 1–8 can be skipped with "Let the Foreman decide". Step 9 can't be skipped for the milestones that need it.
- A **summary page** before signing shows everything in plain words, plus "Keys we'll ask for after you sign: Supabase (test project), Resend (test key)".
- Copy, in the Foreman's voice:
  - "Test keys only. Your real keys go into your own hosting at the end. I never see them."
  - "Not sure? Pick 'Let the Foreman decide'. You can change it before you sign."

## 6. Validation and guardrails

- Zod schemas shared between `yard-web` and `yard-api` (`packages/yard-contracts`), separate from the dependency-free domain.
- Live-key patterns refused with a clear message. The list is kept in one file and tested.
- The intake text goes through the prompt-injection test set ([Y15](Y15-roadmap-and-tasks.md)) before the Foreman reads it. The Foreman sees the form as **data**.
- If the buyer pastes a secret into a free-text field, a client- and server-side scanner (gitleaks rules) blocks the save: "That looks like a key. Put it in step 9 instead."

## Current implementation evidence

The local intake API saves private drafts in separate tables, using server-owned buyer identities and the shared clock. Each autosave atomically commits its version, exact retry receipt and an `intake.saved` event containing only step/version metadata. Version conflicts require a reload; a failed event write rolls the whole save back. Signed owner-only reads and event streams support recovery. Services are choices, without credential fields.

The shared schemas reject unknown fields and bound text, lists, links and money. A bounded scanner blocks recognised test/live tokens and private-key formats before draft persistence or Foreman calls, including revision feedback. It is protection against accidental pasting, not proof of provider scope or a guarantee that arbitrary secrets are recognisable. The full wizard/planner connection and qualified signing are still being built. Credential intake is disabled until the separate encrypted-vault and provider-qualification tasks land.

The saved-version planning endpoint now carries all eight intake sections into the Foreman's immutable context. The server resolves the selected repository's commit; a buyer does not supply a trusted commit hash. A retry of the same saved version returns its original plan rather than re-resolving a moving repository. Model output cannot extend the chosen deadline or budget. Review acceptance remains `READY_FOR_BASELINE`: it is neither signing nor payment authorisation. The connected browser wizard and clarification are still in progress; the local repository and model providers are simulated.

The local app now connects eight private steps to autosave, a plain-language summary and the scripted Foreman review/revision flow. On the mock site, choose **Buyer → Describe a project → Start a private intake**. Keep the saved intake link to resume after reload. A changed draft in another tab requires **Reload saved version**; a lost autosave reply keeps its exact request key, body and version when retried. Budget conversion uses integer arithmetic, and the initial deadline comes from the shared simulated clock rather than the browser's real date. The simulation date is shown.

The form currently uses labelled text/list/service inputs; feature-specific question controls and the Foreman's clarification loop remain unfinished. A Foreman choice cannot invent a buyer's budget, repository, sign-off identity or consent. Review acceptance only reaches the baseline gate; tests have not been qualified and no mandate or payment is created. The browser and server scanner block recognised pasted keys; arbitrary secrets and provider scope still need the separate qualification work. Step 9 remains disabled.
