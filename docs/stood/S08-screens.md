# S08: Screens

Six screens [U]. Each one lists its empty, loading and failed states. Rule: *if a frame doesn't release, refuse, or dispute, it doesn't ship.*

| # | Screen | Who | Purpose |
|---|---|---|---|
| 1 | **Allowance (sign)** | Ama | Agree once what "done" means for each stage, and approve via PayPal |
| 2 | **Package (pending)** | Kojo | Capture instructions, the nonce, upload status, fee result |
| 3 | **Decision** | Ama, Kojo (their own version), the judge | The only screen in the video. Released / Refused / In review |
| 4 | **Receipt** | Ama, forwardable | What was paid, against what, when, by whom (an agent) |
| 5 | **Dispute packet** | Ama → PayPal | The ready-to-file evidence |
| 6 | **Reviewer file** | Reviewer, Esi | One-page audit, plus a queue of wait decisions |

## 1. Allowance (sign)

- **Content:** plot pin plus tolerance radius (a static map tile, not an interactive map). Stage list with amount, required shots and window. Total cap. "Nothing is paid until each stage is seen." A PayPal approve button.
- **Empty:** n/a (the platform pre-fills it).
- **Loading:** "Opening PayPal…"
- **Failed:** "PayPal didn't open. Nothing was signed. Try again." / If declined: "You didn't approve. Nothing was signed."

## 2. Package (pending): Kojo

- **Content:** stage name, distance to the pin (live), the nonce code in large type, a checklist of required shots, the queue status.
- **Empty:** "No visit assigned."
- **Loading / offline:** "Saved on your phone. 4 of 6 photos waiting for signal."
- **Failed:** each refused field, plus what to redo. The fee status is always visible: "Fee: not paid for this visit" / "Fee: on its way".

## 3. Decision

- **Layout:** the decision word (40px Newsreader) and stamp. One reason sentence (20px). Amount in ink (held amount in stamp red). Below: the evidence strip (photos uncropped, metadata under each). Below that: the file (14px): allowance id, order id, capture or void id, agent flag, times.
- **States:** Released (pass), Refused (stamp plus red rule under the word), In review (dashed). Waiting for the model: "Checking 6 photos…" with each check ticking off as it finishes (plot ✓, reused ✓, stage …). This doubles as the demo moment.
- **Failed (system):** "PayPal didn't answer. Nothing was paid. We'll try again at 14:05."

## 4. Receipt

- Opens without an account (a signed link).
- **Content:** "Foundation, £4,000, released 10:58 by Ama's agent under allowance A-7. Kojo stood on the plot at 10:42, 6 photos, 8 m from the pin." Thumbnail strip. PayPal capture id. A "Dispute this" link.
- **Failed / expired link:** "This receipt link has expired. Ask EyeOnSite for a new one." Never leak data.

## 5. Dispute packet

- **Content:** the allowance as signed, the package, rule results, model findings with confidence, a timeline, PayPal ids. Export as PDF plus JSON.
- **Loading:** "Building the file…"
- **Submitted / not:** "Filed with PayPal, case PP-D-…" **or** "Ready to file. Sandbox can't submit this type." Never a fake success.

## 6. Reviewer file

- **Top:** who allowed it / what was captured / what stood on the plot: three columns.
- **Queue:** wait decisions, oldest first, with time left on the hold. Release / Refuse buttons that require a one-line reason.
- **Built in AG Studio** (the prize is "Best Use of AG Studio"). The reconciliation widget flags PayPal captures with no Stood release (gate bypass) ([S13](S13-sponsor-integration.md)).
- **Grid behaviour:** sort by decision, filter to refused, and the row is the named field. Master-detail rows expand to the evidence. Ama never sees this screen ([S12](S12-hackathon-plan.md)).
- **Stage Gantt (Bryntum, conditional):** lives on the Allowance and the Receipt, not here. It only exists if it's the allowance made visible.
- **Empty:** "Nothing waiting. Last decision 10:58."
