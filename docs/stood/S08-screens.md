# S08: Screens

Product screens remain planned. Every decision shows a reason and a money clause backed by confirmed state.

| Screen | Buyer / builder content | Empty, loading and failed |
|---|---|---|
| Allowance | Operator, $4,000 cap, $1,200 milestone, repository/base commit, frozen signed test manifest, mutation threshold and usage condition | No allowance; opening approval; approval unconfirmed |
| Commit package | Repository/new commit, diff summary, test/report hashes, runner identity and queue status | No commit; fetching exact commit; proof missing or incompatible → WAIT |
| Decision | Verdict word/icon, recipient reason, amount/state, test report and diff evidence strip | Checking evidence; malformed report → WAIT; payment outcome unknown |
| Receipt | Repository, base/new commit SHA, manifest/report hashes, operator, rule version, exact settlement effect/reference and time | Building receipt; expired link → request a new private link |
| Dispute packet | Signed allowance, frozen tests, report, decision history and provider timeline; PDF/JSON export | Building file; ready to file until provider confirms submission |
| Reviewer file | Failed condition, runner/signature status, outside usage authority, hold deadline, operation status and owned alert | No pending rows; loading; provider unavailable with payment unconfirmed |

## Decision details

Show original reports and diff summaries without presenting client strings as trusted execution. A green badge needs the report's identity and signature, not only its appearance. Keep evidence and provider settlement separate. Show queued packages during renewal and unresolved operations older than three hours.

AG Studio reviewer and Bryntum milestone Gantt are planned. Their assistants read and arrange data; they cannot release payments. Keep keyboard/reader labels and narrow-phone layouts. Public receipts never expose repository secrets or signed private-source URLs.

## Scenario: site visits

[EyeOnSite](https://github.com/ma-za-kpe/eyeonsite) uses uncropped photos and distance metadata in place of test reports/diffs. Its capture screen includes the nonce and offline queue. Field display requirements remain in S15.
