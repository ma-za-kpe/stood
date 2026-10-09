# Kernel: approve PayPal sandbox payments unattended, step by step

A practical guide for developers who test PayPal flows that need a **buyer to approve in a browser** (checkout orders, saved PayPal for later payments) and want those tests to run with nobody at the keyboard. It uses a [Kernel](https://www.kernel.sh) cloud browser, driven over the Chrome DevTools Protocol with Playwright. It is written from Stood's own setup on 9 October 2026, including every mistake we made and how we fixed it. Everything here uses the PayPal **sandbox**; no real money moves.

Stood's code is linked at each step, so you can read a working, tested implementation:

- [`services/api/src/adapters/kernel/sandbox-approver.ts`](../../services/api/src/adapters/kernel/sandbox-approver.ts): the approver
- [`services/api/src/adapters/kernel/sandbox-approver.test.ts`](../../services/api/src/adapters/kernel/sandbox-approver.test.ts): its tests, against a fake Kernel API and page
- [`services/api/src/sandbox-run-cli.ts`](../../services/api/src/sandbox-run-cli.ts): where `scripts/dev sandbox-run` plugs it in

## 1. What you need

| Value | Where it comes from |
| --- | --- |
| `KERNEL_API_KEY` | [dashboard.onkernel.com](https://dashboard.onkernel.com) → **API Keys** → Create. Shown once. |
| `PAYPAL_SANDBOX_BUYER_EMAIL` | developer.paypal.com → **Testing Tools → Sandbox Accounts** → the **Personal** account (`sb-…@personal.example.com`) |
| `PAYPAL_SANDBOX_BUYER_PASSWORD` | Same row → **⋯ → View/Edit account**. A test password, never a real login. |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | Your sandbox **Merchant** app (see the [PayPal guide](paypal-sandbox-authorize-capture-void.md)) |

Put them in a gitignored `.env` (mode 600). `scripts/dev sandbox-run` copies only these names into the container, through a private temporary file.

## 2. Run it

```bash
scripts/dev sandbox-run release       # buyer approves, Stood authorizes and captures
scripts/dev sandbox-run refuse        # buyer approves, Stood authorizes and voids
scripts/dev sandbox-run vault-setup   # buyer agrees to save PayPal; later holds need no approval
```

With the three Kernel values set, each run prints `Kernel is approving as the SANDBOX buyer in a cloud browser...` and finishes on its own. Without them it prints the approval link for a person, as before. Our first unattended runs: **CAPTURED**, **VOIDED** and **VAULTED**, recorded under [`services/api/test/scenarios/sandbox/`](../../services/api/test/scenarios/sandbox/).

## 3. How it works

1. `POST https://api.onkernel.com/browsers` with `{ "headless": true, "timeout_seconds": 300 }` returns `session_id` and `cdp_ws_url`.
2. Playwright connects with `chromium.connectOverCDP(cdp_ws_url)`. Only `playwright-core` is needed: the browser runs at Kernel, so nothing is downloaded.
3. The approver opens the PayPal link, signs in as the sandbox buyer and clicks the approve button.
4. `DELETE https://api.onkernel.com/browsers/{session_id}` ends the session (it answered **204**). The five-minute idle timeout is a backstop if the delete is ever missed.
5. The caller confirms approval **from PayPal's API**, never from the page: the sandbox run polls the order until it is `APPROVED`.

## 4. Safety rules we kept

- **Sandbox only.** The approver refuses any link that is not exactly `https://www.sandbox.paypal.com`. A look-alike such as `https://www.sandbox.paypal.com.evil.example` is refused before Kernel is called.
- **Exact host checks.** CodeQL flagged our first version, `hostname.endsWith('paypal.com')`, which `notpaypal.com` also satisfies. Match `paypal.com` or a real subdomain (`.paypal.com`) instead.
- **The password never appears** in logs, errors or recordings. Recordings keep ids, statuses and amounts only.
- **Always end the cloud browser**, even when a step fails (`finally`).

## 5. What PayPal's sandbox pages look like (October 2026)

We probed the real pages through Kernel before writing selectors: a one-off script printed each screen's URL, visible buttons and inputs, and saved a screenshot. That was faster than guessing.

| Screen | URL path | What to match |
| --- | --- | --- |
| Email | `/pay` | `input[type=email]`, button **Next** (no id) |
| Password | `/pay/` | `input[type=password]`, button **Log In** (no id) |
| Checkout order | `/pay/checkout` | `#one-time-cta`, **Review Order** |
| Save PayPal (vault) | `/pay/billing` | `#consentButton`, **Agree and Continue** |
| Older layout | `/checkoutnow` | `#email`, `#btnNext`, `#password`, `#btnLogin`, `#payment-submit-btn` |

Stood's selectors accept both the new and the older layout.

## 6. Mistakes we made, and the fixes

1. **Old ids.** Our first version waited for `#btnNext`/`#btnLogin`/`#payment-submit-btn`. The new `/pay` flow has buttons without ids, so the approve click timed out after sign-in. Fix: match by input type and button text, keeping the old ids as alternatives.
2. **The page was in Portuguese.** Kernel's browser got a Portuguese page ("Avançar" instead of "Next"), so text selectors failed. Fix: add `locale.x=en_US` to the PayPal link.
3. **Waiting for a redirect that never comes.** We waited for PayPal to send the buyer back to a return URL. Plain checkout orders created without `experience_context` have no return URL, so PayPal stays on its own page, even though the order **is** approved. Fix: give PayPal 15 seconds to redirect if it will, then let the caller confirm `APPROVED` from the API.
4. **"Agree and Continue", not "Agree & Continue".** The save-PayPal page uses the word "and". Fix: match `#consentButton` and the real label.
5. **Fake values that look like secrets.** A made-up checkout token in a test (`token=5O19…`) was flagged by GitGuardian as a high-entropy secret. Fix: use plainly fake values such as `EC-TEST-TOKEN`.

## 7. Cost

Each approval opens one headless browser for under a minute and deletes it. Set a usage cap in the Kernel dashboard if it offers one.
