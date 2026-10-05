# Y21: The Crew service contract

**Decision (2026-10-05):** the engineering team (the Crew) is **not part of this repository**. It lives in a **separate, closed project** and runs on **Vast.ai**. Yard reaches it only through a **service endpoint**, the same way it reaches Stood.

- This repo (open source) holds Yard (Foreman, Board, web) and Stood.
- The Crew project (closed) holds the models, prompts, the LangGraph graph, the GPU lifecycle and the cost model.

This supersedes the `services/yard-crew/` folder in [Y11](Y11-architecture-and-codebase.md). The engineer updates Y11 and Y15 after PR #32 merges (see §7).

## 1. Why separate

| Reason | Detail |
|---|---|
| **Fair Board** | The Crew must get no special treatment ([Y02](Y02-product-boundary.md) rule 5). Being outside the repo, with no database access, proves it: it uses the same public A2A / HTTP surface any third-party agent uses |
| **It's the commercial moat** | Prompts, routing, model choices and GPU economics are the operator's business, not the open-source gate |
| **Different runtime** | Python, GPUs, vLLM, Vast.ai instances that start and stop. Nothing like the Node services here |
| **Blast radius** | A compromised Crew can't touch Yard's or Stood's data, keys or code |

## 2. Two surfaces, nothing else

| Surface | Direction | Purpose |
|---|---|---|
| **The Board (A2A + HTTP)** | Crew → Yard | Discover, claim, submit, clock out, exactly like any builder ([Y06](Y06-the-board-work-orders-and-a2a.md), [Y12](Y12-data-model-and-api.md)) |
| **The Crew dispatch endpoint** | Yard → Crew | An optional **nudge**: "work orders matching your skills were posted". Plus the status Yard shows in the project room |

The Crew **must also work with the nudge off**, by polling the Board. The nudge is a convenience, never a privilege. Other operators can register the same webhook.

## 3. Crew dispatch API (served by the Crew project)

Base: `https://<crew-endpoint>/crew/v1` (the endpoint fronts the Vast.ai fleet. Instances behind it come and go).

| Method | Path | Body / result |
|---|---|---|
| GET | `/health` | `{ status, models: [...], capacity: { free_slots }, version }` |
| GET | `/.well-known/agent.json` | The Crew's A2A agent card: skills, stacks, price floor, operator id |
| POST | `/nudges` | `{ work_order_ids: [...], board_url }` → `202 { accepted: [...], declined: [{ id, reason: "stack" \| "price_below_cost" \| "capacity" }] }` |
| GET | `/jobs/{work_order_id}` | `{ state: "evaluating" \| "queued" \| "building" \| "testing" \| "submitted" \| "clocked_out", gpu_minutes, attempt, last_event_at }` |
| POST | `/jobs/{work_order_id}/cancel` | Yard asks the Crew to stop (lease revoked, buyer cancelled). The Crew clocks out on the Board |

- **Auth, Yard → Crew:** HMAC-signed requests (the same scheme Stood uses for webhooks), with a key id so it can be rotated.
- **Auth, Crew → Yard:** the Crew's **operator key** + signed requests, the same as every builder.
- **Idempotency:** `Idempotency-Key` on `POST`, and a nudge for a work order already being evaluated is a no-op.
- **Timeouts:** Yard waits 5s on any Crew call and never blocks a user action on it. If the Crew is down, work orders simply stay on the Board for others.

## 4. Site-log events from the Crew

The Crew streams progress into the work order's site log through the Board API (`POST /work-orders/{id}/log`, batched, at most 1 request per second). Yard re-broadcasts it over SSE ([Y18](Y18-realtime-state-management.md)).

```json
{ "seq": 41, "at": "2026-11-02T10:14:03Z", "kind": "test_run",
  "message": "12 of 14 signed tests passing", "data": { "passed": 12, "total": 14 } }
```

Kinds: `plan`, `edit`, `test_run`, `commit`, `submit`, `punch_list_received`, `clock_out`, `note`.

**Rules:**

- Messages are plain text.
- No secrets, no file contents longer than 20 lines, no model chain-of-thought.
- Yard scans every line (gitleaks rules) before storing it, and drops it if it matches.

## 5. What the Crew never receives

- Database access to Yard or Stood.
- Buyer secrets. The Crew builds against emulators and fakes, like every builder ([Y19](Y19-intake-form.md) §3).
- PayPal credentials of anyone. Its operator's PayPal account is the payee, configured on the Board.
- Write access beyond the `wo/*` branch of the one repo it claimed (GitHub App installation token, short-lived).
- Any "fast path" to Stood. Its commits are checked by the same runner, under the same rules.

## 6. Contract tests (in this repo)

Yard ships a **fake Crew** (`services/yard-api/test/fakes/crew`) that implements §3 from a fixture file. It's used in the demo (Y3a "demo Crew") and in CI. The real Crew project runs the same contract test suite against its own endpoint before each deploy. The OpenAPI spec for §3 lives here as `docs/yard/contracts/crew-v1.yaml` (to be written in Round Y-D), so the open repo defines the contract and the closed repo conforms to it.

## 7. Follow-ups for the engineer (after PR #32 merges)

1. **Y11:** replace `services/yard-crew/` with "external: Crew service (separate project), reached over §3 and the Board". Update the diagram node to `CREW[Crew service · external · Vast.ai]`.
2. **Y15:**
   - Round Y-D becomes "fake Crew + contract spec".
   - Round Y-E moves to the Crew project's own backlog. This repo only keeps the contract tests.
3. **dependency-cruiser:** no path in this repo may be named `crew` except the fake and the contract.
