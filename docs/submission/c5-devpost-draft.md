# C5 Devpost draft and demo storyboard

This file is a submission draft, not a submitted Devpost entry. Replace every bracketed owner field only after the corresponding evidence exists. No video URL, score, sponsor prize claim or public qualification is asserted here.

## Project description draft

**Stood is a payment decision gate for milestone work.** A buyer sets the scope, price and acceptance evidence before work begins. A builder submits a commit and evidence. Stood checks the agreed proof, then confirms a PayPal sandbox capture or void only after PayPal confirms the provider outcome. The platform does not hold money, and an AI proposal cannot release it.

Yard is the hosted buyer and builder workspace for Stood. A buyer can create a private project brief, ask the Foreman to propose a draft plan, review milestone tests and deadlines, and follow the work-order and payment states. Builders work in an isolated repository. Stood runs frozen buyer tests in a disposable Vercel Sandbox microVM, stores the signed result, applies deterministic rules and reconciles the resulting sandbox payment with PayPal. A final milestone can wait for the buyer's signed usage confirmation. Yard also supports a read-only milestone timeline and a buyer-only reconciliation file.

The prototype is deliberately sandbox-only. A green assessment is not itself a payment receipt; Stood waits for provider evidence. The project does not claim production payment authorization, escrow, trusted photo assessment, a complete hosted AI reviewer, or a public self-serve submission flow.

**Who it is for:** platforms that assign bounded milestone work to people or agents and need an auditable acceptance and payment boundary.

**What is different:** the model proposes work, but fixed buyer terms and deterministic checks control acceptance. The runner cannot change the buyer's tests, and the code under test cannot author its own result. PayPal remains the payment system of record.

## Tools and how they were used

| Tool | Use in the project | Evidence to link in final entry |
| --- | --- | --- |
| PayPal Orders v2, Vault and Payouts (sandbox) | Buyer-authorized sandbox funding, provider-confirmed capture/void, saved mandate flow and builder payout | [PayPal run guide](../guides/paypal-sandbox-authorize-capture-void.md), [payout guide](../guides/paypal-payouts-builder-payouts.md), provider-backed run record |
| PayPal AI Toolkit MCP | Read-only trace lookup during sandbox reconciliation and debugging; never the payment authority | [AI Toolkit integration note](../tech/T16-paypal-ai-toolkit.md) and public issue thread if relevant |
| xAI Grok | Proposes a blueprint under a shared daily budget; it does not decide payment | [Grok guide](../guides/grok-yard-planner.md), sanitized qualification record |
| Vercel Sandbox | Runs buyer-frozen tests in disposable isolated microVMs without credentials or network during test execution | [runner guide](../guides/vercel-sandbox-untrusted-code-judge.md), `runner-check` evidence |
| GitHub App | Short-lived, repository-scoped access for Yard's throwaway sandbox repository | [GitHub App guide](../guides/github-app-yard.md), sandbox run |
| Render | Hosts Stood API, reconciler and Yard; pre-deploy migrations gate the release | [Render guide](../guides/render-stood-yard-deployment.md), current service commit/state |
| AG Studio | Displays buyer-authorized, read-only milestone and payment reconciliation sources; plain tables remain as license fallback | [AG Studio guide](../guides/ag-studio-reviewer-file.md), screenshot after a licensed visual check |
| Bryntum Gantt | Lazy-loaded read-only milestone timeline from the signed room snapshot | [Bryntum guide](../guides/bryntum-milestone-timeline.md), screenshot after a visual check |
| Zapier | Optional outbound delivery of durable Yard notices through an owner-configured private Catch Hook | [Zapier guide](../guides/zapier-yard-notifications.md), synthetic test-Zap receipt if enabled |
| Cloudflare R2 | Private, hash-addressed evidence storage with short-lived signed URLs | [R2 guide](../guides/cloudflare-r2-evidence.md), `evidence-check` output with identifiers redacted |
| GitGuardian | Scans commits not yet on `main`; local detector rejects secret-like examples | [GitGuardian guide](../guides/gitguardian-secret-scanning.md), CI/push check |
| StartupTribunal | Imports attributed public idea cards into buyer-owned private drafts | [catalog guide](../guides/startuptribunal-catalog-import.md), live catalog observation |
| APIMatic | Generates the Stood SDK and API reference from the OpenAPI contract | [APIMatic guide](../guides/apimatic-sdk-from-openapi.md), generated SDK check |
| Kernel | Drives a sandbox browser for buyer approval; the result is independently checked through PayPal APIs | [Kernel guide](../guides/kernel-paypal-sandbox-approval.md), approval qualification |

Use the tools table only for tools actually present in the final build and with the linked evidence. Remove any row whose feature is not qualified at submission time. AG Studio's dashboard is not an LLM assistant; do not say it supplies AI. The Foreman is the product's AI use.

## Demo video script (target 2:35, maximum 2:59)

Record the actual app and label sandbox/test data visibly. Show the browser URL and no secrets. Capture the screen at 1080p, use captions, and keep the microphone narration consistent with those captions. Do not show third-party logos unless their terms permit it. Retain the raw recording privately and review the final YouTube upload while logged out.

| Time | Screen and action | Spoken/caption text |
| --- | --- | --- |
| 0:00–0:15 | Show the hosted project and title card, “Stood · milestone payment gate · PayPal sandbox” | “Milestone work often ends with a trust gap: the builder says it is done, but the buyer cannot connect acceptance evidence to payment. Stood makes the terms and evidence explicit before money moves.” |
| 0:15–0:38 | Buyer signs in, opens a disposable private brief, reviews editable fields and source attribution | “Yard is the buyer workspace. This brief is private, editable and attributed. Nothing is signed or funded while the buyer is still planning.” |
| 0:38–1:00 | Show the Foreman plan and tests; point out fixed cap/deadline and buyer review | “Grok drafts a plan and test cases. Yard validates the structure and calculates milestone prices and deadlines from the buyer's fixed terms. The model cannot alter those terms or trigger payment.” |
| 1:00–1:22 | Show a signed/qualified milestone and builder submission/commit | “The builder submits a commit against the frozen acceptance tests. The submission is evaluated in a disposable Vercel Sandbox environment; buyer tests and builder code cannot rewrite each other.” |
| 1:22–1:48 | Show decision and matching PayPal sandbox provider record/capture count | “Stood records the deterministic decision, then reconciles PayPal's provider response. A decision alone is not called paid. This is a sandbox capture; no real money moves.” |
| 1:48–2:08 | Show failed/refused path or a waiting state with named reason | “When evidence is missing or a check fails, Stood waits or refuses and follows the matching provider state. It does not guess from a green badge.” |
| 2:08–2:25 | Show buyer reviewer file and Bryntum timeline only if the live visual run is clean and licensed | “The buyer can inspect a read-only reconciliation and milestone timeline. These views cannot change scope or money. If AG Studio's license is absent, Yard shows its plain tables.” |
| 2:25–2:35 | End on public repo/docs URL and short sandbox note | “Stood is open source and sandbox-only today. See the repository for the decision rules, provider evidence and setup.” |

If the reviewer panel or Gantt shows a license watermark, console errors or misleading state, omit that shot and record the known limitation instead. Do not use a mocked UI to imply a live integrated feature.

## Devpost fields to complete after qualification

- Public demo URL: `[owner: verify the logged-out URL and whether judges need a Yard access code]`
- YouTube video: `[owner: record, caption, upload publicly, verify logged out, paste URL]`
- Public source repository: `https://github.com/ma-za-kpe/stood`
- Project website: `https://ma-za-kpe.github.io/stood/`
- AI: xAI Grok proposes Yard drafts; model output is checked and cannot authorize payments.
- PayPal technology: Orders v2 sandbox funding and capture/void; Vault sandbox consent; PayPal Payouts sandbox builder payout; PayPal API reads independently verify outcomes.
- APIMatic plugin question: “Yes. The PayPal APIMatic Context Plugin was used during integration/debugging to ground SDK/API work. It did not make provider calls on behalf of the product; the test and qualification clients called PayPal sandbox APIs.” Edit if the actual Devpost wording or final tool usage differs.
- Partner prizes: `[owner: select only categories whose exact criteria have been met and evidence is publicly accessible]`
- Official rules/IP/eligibility check: `[owner: read and record date]`

## Submission gate

Before posting, replace brackets, remove unsupported rows/claims, verify every link and repository license, confirm the final video is under three minutes with captions, test it while logged out, and complete the official eligibility/rules review. Devpost submission and public video upload require the owner's account; neither is performed by this draft.
