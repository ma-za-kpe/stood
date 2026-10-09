# Kernel: approve PayPal sandbox payments unattended, step by step

A practical guide for developers who test PayPal flows that need a **buyer to approve in a browser** and want those tests to run with nobody at the keyboard. It uses a [Kernel](https://www.kernel.sh) cloud browser, driven over the Chrome DevTools Protocol (CDP) with Playwright. It is written from Stood's own runs on 9 October 2026, including every mistake we made and how we fixed it. Everything here uses the PayPal **sandbox**: no real money moves, and the buyer is a PayPal test account.

Stood's code is linked at each step, so you can read a working, tested implementation:

- [`services/api/src/adapters/kernel/sandbox-approver.ts`](../../services/api/src/adapters/kernel/sandbox-approver.ts): the approver
- [`services/api/src/adapters/kernel/sandbox-approver.test.ts`](../../services/api/src/adapters/kernel/sandbox-approver.test.ts): its tests, against a fake Kernel API and a fake page
- [`services/api/src/sandbox-run-cli.ts`](../../services/api/src/sandbox-run-cli.ts): where `scripts/dev sandbox-run` plugs it in
- [`services/api/src/application/sandbox-run.ts`](../../services/api/src/application/sandbox-run.ts): the sandbox run that creates the order, waits for approval and settles

## 1. The problem Kernel solves

Stood holds money first and decides later. A buyer's payment is **authorized** (held), and only a rule decision **captures** it (release) or **voids** it (refuse). The PayPal REST API can do every step of that except one: a buyer must approve the order or the saved-payment agreement in PayPal's own page, signed in as themselves. There is no API for "the buyer clicked Approve".

That one browser step used to stop every end-to-end test. Someone had to open a link, sign in as the sandbox buyer and click. Judges, reviewers and our own regression runs could not replay the real outcomes without a person.

Kernel gives us a browser in the cloud that a program can drive. With it, the buyer step becomes code: sign in as the sandbox buyer, click approve, close the browser.

## 2. Kernel's role in the whole platform

Stood is the payment-decision layer (it holds, decides, then captures or voids through PayPal). Yard is a build marketplace that uses Stood to pay builders per milestone. Kernel sits on the **buyer's side of the PayPal sandbox**, outside the money decision:

```text
           Yard (work orders, Board)            Stood (holds, rules, ledger)
                     │                                     │
                     │ signed API: allowances, packages    │ PayPal REST: orders, authorize,
                     └────────────────────────────────────►│ capture, void, vault
                                                           │
                                                           ▼
                                               PayPal SANDBOX ◄── buyer approval page
                                                                        ▲
                                                                        │ signs in, clicks approve
                                                               Kernel cloud browser
                                                       (only in sandbox runs and tests)
```

What Kernel does, and does not do, in Stood:

| Kernel does | Kernel never does |
| --- | --- |
| Plays the **sandbox buyer**: signs in and approves an order or a saved-PayPal agreement | Decide whether money moves: only Stood's rules do, from verified evidence |
| Lets `scripts/dev sandbox-run` replay real outcomes unattended | Run in Stood's production path: real buyers approve in their own browser |
| Gives judges and reviewers a repeatable path through the real PayPal sandbox | Touch real PayPal: it refuses any link that is not `https://www.sandbox.paypal.com` |
| | See or store secrets beyond the sandbox buyer's test login |

Planned, not live yet: Yard's `BrowserQa` port ([`services/yard-api/src/ports/browser-qa.ts`](../../services/yard-api/src/ports/browser-qa.ts)) is meant to use a Kernel browser to visit a builder's deployed preview and report what it sees, as findings only, never payment. It currently has no live adapter.

## 3. Use cases

1. **Replay every sandbox outcome for judges.** `release` (captured), `refuse` (voided) and `vault-setup` (saved PayPal) all need a buyer; Kernel makes each one a single command.
2. **Regression-test PayPal integrations.** PayPal changes its checkout pages; an unattended run catches it the day it happens (ours did, see section 9).
3. **Save PayPal once, then test later holds without a browser.** `vault-setup` approves the saved-payment agreement through Kernel; `vault-release` and `vault-refuse` then run with no buyer at all.
4. **Record evidence.** Each run writes a JSON recording (ids, statuses, amounts) that tests and reviewers can read, plus a second-witness command to check it against PayPal.
5. **Demos without a live login on screen.** The buyer step happens in the cloud; nobody types a password in front of an audience.
6. **(Planned) Preview QA.** Visit a builder's preview and report findings, as described in section 2.

## 4. Results from our first unattended runs

| Command | What PayPal did | Outcome |
| --- | --- | --- |
| `scripts/dev sandbox-run release` | Kernel approved the order; Stood authorized and captured, then replayed the capture once to prove it is not duplicated | **CAPTURED** |
| `scripts/dev sandbox-run refuse` | Kernel approved; Stood authorized and voided | **VOIDED** |
| `scripts/dev sandbox-run vault-setup` | Kernel agreed to save PayPal for later payments | **VAULTED** |

Recordings: [`services/api/test/scenarios/sandbox/`](../../services/api/test/scenarios/sandbox/) (files dated 2026-10-09T20–21). They hold ids, statuses and amounts only: no buyer login, and no saved payment token.

## 5. Setup

### 5.1 Kernel API key

1. Sign up or log in at [dashboard.onkernel.com](https://dashboard.onkernel.com).
2. Open **API Keys** → **Create API key**. Name it for its job, for example `stood-sandbox-approval`.
3. Copy the key; it is shown once.
4. If the dashboard offers a usage cap, set a low one.

### 5.2 The PayPal sandbox buyer

1. Log in at [developer.paypal.com](https://developer.paypal.com).
2. Open **Testing Tools → Sandbox Accounts**.
3. Use the account whose type is **Personal** (`sb-…@personal.example.com`). If there is none: **Create account → Personal**, country **United States**.
4. **⋯ → View/Edit account** shows the email and the system-generated password. You can set your own test password there.
5. Use the same personal account across runs, so saved-payment history stays consistent.

This is a test identity. Never put a real PayPal login here.

### 5.3 `.env`

Add to the gitignored `.env` (mode 600), next to your sandbox app's `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` (see the [PayPal guide](paypal-sandbox-authorize-capture-void.md)):

```bash
KERNEL_API_KEY=...
PAYPAL_SANDBOX_BUYER_EMAIL=sb-...@personal.example.com
PAYPAL_SANDBOX_BUYER_PASSWORD=...
```

`scripts/dev sandbox-run` copies only the names it needs into the container, through a private temporary file that it deletes afterwards.

## 6. Run it

```bash
scripts/dev sandbox-run release       # buyer approves; Stood authorizes and captures
scripts/dev sandbox-run refuse        # buyer approves; Stood authorizes and voids
scripts/dev sandbox-run vault-setup   # buyer agrees to save PayPal; later holds need no approval
scripts/dev sandbox-run vault-release # from the saved PayPal, no browser
scripts/dev sandbox-run vault-refuse  # from the saved PayPal, no browser
```

Expected output with Kernel configured:

```text
Kernel is approving as the SANDBOX buyer in a cloud browser...
Approved in the sandbox.
Outcome: CAPTURED
Recorded: services/api/test/scenarios/sandbox/sandbox-release-<time>.json
Second witness: tools/paypal-witness/witness.py order <order id>
```

Without the three Kernel values, the run prints the approval link for a person instead, as before.

**Side effect of `vault-setup`.** It saves a new `PAYPAL_SANDBOX_VAULT_TOKEN_ID` into `.env` (never printed), replacing the previous one. Only the sandbox runs use it.

## 7. How it works

1. **Check the link.** Anything but `https://www.sandbox.paypal.com` is refused before Kernel is called.
2. **Create a browser.** `POST https://api.onkernel.com/browsers` with `{ "headless": true, "timeout_seconds": 300 }` returns `session_id` and `cdp_ws_url`.
3. **Connect.** `chromium.connectOverCDP(cdp_ws_url)` from `playwright-core`. The browser runs at Kernel, so nothing is downloaded.
4. **Open the page in English.** The approver adds `locale.x=en_US` to PayPal's link.
5. **Sign in** as the sandbox buyer: email, **Next**, password, **Log In**. If PayPal remembers the buyer, it goes straight to the approve step.
6. **Approve.** Click **Review Order** for an order, or **Agree and Continue** to save PayPal.
7. **Hand back.** With a return URL, PayPal redirects within seconds. Without one, it stays on its own page. The approver waits up to 15 seconds, then returns either way.
8. **Close and delete.** The CDP connection closes, then `DELETE https://api.onkernel.com/browsers/{session_id}` ends the session (it answered **204**). The 300-second idle timeout is a backstop.
9. **Confirm from PayPal, not the page.** The sandbox run polls PayPal's API until the order is `APPROVED`, then authorizes. A page that looks approved never counts.

## 8. Safety rules

- **Sandbox only.** Exact protocol and host check on the link; look-alike hosts such as `https://www.sandbox.paypal.com.evil.example` are refused, with tests.
- **Exact host checks everywhere.** CodeQL flagged our first version, `hostname.endsWith('paypal.com')`, which `notpaypal.com` also satisfies. We now match `paypal.com` or a real `.paypal.com` subdomain.
- **No secrets in output.** The password never appears in logs, errors, test output or recordings.
- **Always end the browser**, even when a step fails (`finally`).
- **Approval proof comes from PayPal's API**, so a misread page cannot cause a capture.

## 9. What PayPal's sandbox pages look like (October 2026)

We probed the real pages through Kernel before writing selectors. A one-off script printed each screen's URL, visible buttons and inputs, and saved a screenshot. That was much faster than guessing.

| Screen | URL path | What to match |
| --- | --- | --- |
| Email | `/pay` | `input[type=email]`, button **Next** (no id) |
| Password | `/pay/` | `input[type=password]`, button **Log In** (no id) |
| Checkout order | `/pay/checkout` | `#one-time-cta`, **Review Order** |
| Save PayPal (vault) | `/pay/billing` | `#consentButton`, **Agree and Continue** |
| Older layout | `/checkoutnow` | `#email`, `#btnNext`, `#password`, `#btnLogin`, `#payment-submit-btn` |

Stood's selectors accept both the new and the older layout.

## 10. Mistakes we made, and the fixes

| # | What happened | Fix |
| --- | --- | --- |
| 1 | **Buttons without ids.** We waited for `#btnNext`, `#btnLogin` and `#payment-submit-btn`. PayPal's new `/pay` checkout has buttons without ids, so the approve click timed out after sign-in. | Match by input type and the button's label (**Next**, **Log In**, **Review Order**, **Agree and Continue**), keeping the old ids as alternatives. |
| 2 | **The page was in Portuguese.** Kernel's browser got "Avançar" instead of "Next", so label selectors failed. | Add `locale.x=en_US` to the PayPal link. |
| 3 | **Waiting for a redirect that never came.** Plain checkout orders created without a return URL leave the buyer on PayPal's page, even though the order is approved. | Wait up to 15 seconds for a redirect if there is one, then let the caller confirm `APPROVED` from PayPal's API. |
| 4 | **"Agree and Continue", not "Agree & Continue".** The save-PayPal button uses the word "and". | Match `#consentButton` and the real label. |
| 5 | **A loose host check.** `endsWith('paypal.com')` also accepts `notpaypal.com` (found by CodeQL). | Exact host or a real subdomain, with a look-alike test. |
| 6 | **A fake value that looked like a secret.** A made-up checkout token in a test (`token=5O19…`) was flagged by GitGuardian as a high-entropy secret. | Use plainly fake values such as `EC-TEST-TOKEN`. |

## 11. Troubleshooting

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| `NOT_SANDBOX` | The link is not the PayPal sandbox | Check the PayPal app and base URL are sandbox |
| `KERNEL_UNAVAILABLE 401` | Wrong or expired `KERNEL_API_KEY` | Create a new key |
| Timeout waiting for an email or approve button | PayPal changed its page | Probe the page as in section 9 and add the new selector, keeping the old ones |
| Approved in the sandbox, then `NOT_APPROVED` | PayPal did not record the approval | Rerun; check the buyer account is a US **Personal** account |
| `Kernel is approving` never appears | One of the three values is empty | Fill `KERNEL_API_KEY`, `PAYPAL_SANDBOX_BUYER_EMAIL` and `PAYPAL_SANDBOX_BUYER_PASSWORD` |

## 12. Cost

Each approval opens one headless browser for under a minute and deletes it. The whole qualification (three runs plus four probes) used a handful of browser-minutes. Set a usage cap in the Kernel dashboard if it offers one.
