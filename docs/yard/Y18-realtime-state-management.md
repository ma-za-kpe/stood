# Y18: Real-time state management

Yard is the **most stateful surface in the family**. A buyer watches a project room where:

- several milestones move at once
- builders clock in and out
- the Crew streams a site log
- Stood sends verdicts that move money

If the screen ever shows something that isn't true (a milestone "paid" before Stood released it, or a card stuck in "Checking" after a refusal), we have lost the user's trust. This doc defines how state flows so that **can't** happen.

## 1. Principles

1. **The server is the only source of truth.** The browser holds a *projection* of server state, never its own version of it.
2. **Money states are never optimistic.** `PAID`, `REFUSED`, `HELD` and `VOIDED` appear only after Yard has received the **signed Stood webhook** (or read it back from Stood). Clicking a button never makes a card look paid.
3. **Every change is an event with a sequence number.** No event, no change on screen.
4. **Gaps are detected, never guessed.** If the client misses an event, it refetches, rather than inferring.
5. **Commands and updates travel separately.** Commands go up as HTTP POST with an `Idempotency-Key`. Updates come down as a stream. A command's response is an acknowledgement, not the new state.
6. **Stale is a state.** If the stream is down, the UI says so (Y17 connection pill) and dims timestamps. It never pretends to be live.

## 2. Server side: an event log per blueprint

```text
yard.events (
  stream_id   uuid,        -- the blueprint id (one stream per project)
  seq         bigint,      -- 1, 2, 3 … gap-free per stream (assigned in the same transaction)
  event_id    uuid unique, -- dedupe key (also the SSE id)
  type        text,        -- see the catalogue below
  actor       text,        -- buyer | foreman | builder:<id> | stood | system
  payload     jsonb,       -- small. Large data (logs, diffs) is referenced by id
  causation   uuid,        -- the command or webhook that caused it
  at          timestamptz,
  primary key (stream_id, seq)
)
```

- **Write path:** a command handler validates, updates the domain tables (`work_orders`, `claims`, …) **and** appends the event in **one transaction**. `seq` = `max(seq)+1` under a row lock on the blueprint (`SELECT … FOR UPDATE`). The event log and the tables can't disagree.
- **Stood webhooks** go through the same path: verify signature → dedupe by Stood's event id → transition the work order → append `stood.*` event. A duplicate webhook is a no-op.
- **The site log** (Y12 `site_log`) is a **separate, high-volume stream per work order**, with its own `seq`. It's lossy-tolerant (display only). The blueprint stream only carries a `site_log.summary` event every N lines or on a milestone change.
- **Retention:** blueprint events are kept forever (they're the audit trail). Site logs are kept 90 days, then summarised.

### Event catalogue (blueprint stream)

| Group | Events |
|---|---|
| Intake / Foreman | `intake.saved`, `foreman.question_asked`, `foreman.milestone_drafted`, `foreman.milestone_inked`, `blueprint.ready`, `blueprint.edited`, `blueprint.approved` |
| Stood mandate | `stood.allowance_created`, `stood.allowance_approved`, `stood.allowance_expired` |
| Board | `wo.posted`, `wo.claimed`, `wo.lease_extended`, `wo.lease_expired`, `wo.released_claim`, `wo.submitted` |
| Stood checks (money) | `stood.tranche_held`, `stood.check_started`, `stood.released`, `stood.refused` (with the punch list), `stood.in_review`, `stood.voided`, `stood.reauthorized` |
| Repo | `repo.created`, `repo.pr_opened`, `repo.merged` |
| Handover / hosting | `preview.deployed`, `preview.expired`, `handover.ready`, `handover.deployed_in_buyer_account`, `handover.rotation_confirmed`, `blueprint.closed` |
| Secrets (metadata only) | `secret.added`, `secret.validated`, `secret.revoked`. **Never the value, never the last 4 in the event** |

## 3. Transport: Server-Sent Events, not WebSockets

| | SSE | WebSocket |
|---|---|---|
| Direction we need | Server → browser (commands already go over HTTP) | Both ways (unused) |
| Resume after a drop | Built in: the browser resends `Last-Event-ID` | We'd build it ourselves |
| Proxies, Render, corporate networks | Plain HTTP | Upgrade sometimes blocked |
| Auth | The session cookie, same as every other request | A separate handshake |

**Decision: SSE.** WebSockets are reconsidered only if we add collaborative editing of the blueprint (two people typing). Even then, the Board and project room stay on SSE.

```text
GET /yard/v1/blueprints/{id}/events          (Accept: text/event-stream)
   Last-Event-ID: 4812                         ← resend from seq 4813
→  id: 4813
   event: wo.claimed
   data: {"seq":4813,"wo":"WO-2","builder":"crew-7","lease_until":"…"}

GET /yard/v1/work-orders/{id}/log?since=…     site-log stream (same format)
GET /yard/v1/board/events                      public Board stream (posted / claimed / paid only, no buyer data)
```

- **Heartbeat:** a comment line (`: hb`) every 15s, so the client and proxies know the stream is alive. No heartbeat for 35s → the client reconnects.
- **Fan-out across instances:** after commit, the writer does `NOTIFY yard_events, '<stream_id>:<seq>'`. Each `yard-api` instance holds one `LISTEN` connection and pushes to its connected clients. **Neon note:** `LISTEN` needs a **direct** (unpooled) connection, because the pooled endpoint runs in transaction mode. If we outgrow this, swap NOTIFY for Render Key Value (Redis) pub/sub. The event log stays in Postgres either way.
- **Replay:** on reconnect the server reads `seq > Last-Event-ID` from the table and streams it before going live. Above 500 missed events, it sends one `snapshot.required` event instead, and the client refetches.

## 4. Client side: four kinds of state, four homes

| Kind | Example | Home |
|---|---|---|
| **Server state** (truth) | blueprint, milestones, work orders, verdicts | **TanStack Query** cache, keyed by resource. Filled by a snapshot fetch, then **patched by events** |
| **Process state** (what step am I in) | the intake wizard, the sign flow, a work order's lifecycle on screen, the connection | **XState** machines (statecharts) |
| **Ephemeral UI state** | the open drawer, the selected card, filters, scroll-paused log | **Zustand** (small, no persistence of truth) |
| **Form state** | the intake form | **React Hook Form + Zod** (the same Zod schemas as the API, from a shared package) |

### The event applier

```ts
// one function, pure, unit-tested against recorded streams
function applyEvent(cache: ProjectCache, e: YardEvent): ProjectCache | "GAP" {
  if (e.seq <= cache.seq) return cache;          // duplicate or old: ignore
  if (e.seq !== cache.seq + 1) return "GAP";     // missed one: refetch snapshot
  return { ...reducers[e.type](cache, e.payload), seq: e.seq };
}
```

- The snapshot endpoint returns `{ data, seq }`. The client never mixes a snapshot with events from a different `seq`.
- `"GAP"` → pause the applier, refetch the snapshot, then resume from the snapshot's `seq`.
- Reducers are the **same transition table** as the server's work-order state machine (generated from one definition in `packages/yard-domain`). An event that is illegal for the current state is a bug: log it, refetch, never apply.

### Work-order machine (shared by server and client)

```text
POSTED ─claim→ CLAIMED ─first push→ BUILDING ─submit→ SUBMITTED ─stood.check_started→ CHECKING
CHECKING ─stood.released→ PAID (final)
CHECKING ─stood.refused→ REWORK ─push→ BUILDING          (attempts < max)
CHECKING ─stood.refused→ ABANDONED → POSTED              (attempts = max)
CHECKING ─stood.in_review→ IN_REVIEW ─stood.released|stood.refused→ …
CLAIMED|BUILDING|REWORK ─lease_expired→ LEASE_EXPIRED → POSTED
```

Only events whose actor is `stood` can enter `PAID`, `REWORK` (from a refusal) or `IN_REVIEW`. That is enforced in the server's transition table and asserted in the client's.

### Optimistic updates: allowed list

| Action | Optimistic? | Why |
|---|---|---|
| Edit a milestone name in the draft | Yes | Draft only, no money |
| Reorder / filter the Board | Yes | Local view |
| Clock in | **Pending only**: the card gets a dashed "Clocking in…" outline until `wo.claimed` arrives | Two builders may race. The server picks one |
| Submit a commit | Pending only | Stood decides |
| Approve / sign | **No.** The PayPal window decides | Money |
| Anything Stood decides | **Never** | Money |

Pending commands time out after 20s into "Didn't hear back. Checking…" and the client fetches the resource. It doesn't resend blindly: the `Idempotency-Key` makes a resend safe, but the UI asks first.

## 5. Multi-tab, multi-device, multi-user

- **One stream per tab is fine** at hackathon scale. Later: a `BroadcastChannel` leader tab holds the stream and relays to the others.
- The buyer, their agent, the builder and a reviewer may all watch the same blueprint. They all receive the **same events**. What each sees is filtered **server-side** by role (builders never receive buyer contact data or secret metadata).
- The **public Board stream** carries only `wo.posted / wo.claimed / wo.paid` with no buyer identity.

## 6. Failure modes the UI must show honestly

| Situation | What the user sees |
|---|---|
| Stream drops | Connection pill → "Reconnecting… last update 12s ago". Cards keep their last state and show a faint `STALE` marker after 30s |
| Replay after reconnect | "Caught up: 14 updates", applied without animation (Y17 §6) |
| Gap detected | A brief "Refreshing…" on the project room. No flicker of wrong states |
| Webhook from Stood is late | Card stays `CHECKING` with "Stood is checking. Usually under 2 minutes." After 10 minutes: "Taking longer than usual" + a link to Stood's receipt page |
| Stood says WAIT (`IN_REVIEW`) | Stood's own "In review" chip. Yard copy: "A person is looking. Nothing's paid yet." |
| Lease expires while the builder is mid-push | `LEASE_EXPIRED` → `POSTED`. The builder's view gets a rebar banner, and their branch is kept |
| Two tabs disagree | Impossible by design: both apply the same `seq`. If a tab is behind, it's `STALE`, not different |

## 7. Testing

- **Recorded streams:** each demo scenario (pass, refuse → punch list → pass, lease expiry, in review, reconnect mid-check) is a JSON file of events. The applier is tested by replaying it, and the final cache is snapshot-tested.
- **Model-based tests:** generate paths through the XState work-order machine. Assert the UI never renders a money state without a `stood.*` event.
- **Chaos test:** drop the stream at random points during a replay. Assert the final screen equals the no-drop screen.
- **Server:** the property "events and domain tables agree" is checked after every integration test (rebuild the projection from events, compare with the tables).

## 8. Libraries (all open source)

| Need | Choice |
|---|---|
| Server cache | TanStack Query v5 |
| State machines | XState v5 (machine definitions shared with the server through `packages/yard-domain`) |
| UI state | Zustand |
| Forms | React Hook Form + Zod |
| SSE client | Native `EventSource` (auto-reconnect + `Last-Event-ID`). A fetch-based reader only if we need custom headers |
| Server | Hono `streamSSE` on `yard-api` |

## Current event-store slice

The restricted Yard runtime can now append project state, an exact command receipt and the next numbered event in one Postgres transaction. Events cannot be updated or deleted. Concurrent stale writes and failed event insertion are tested against a disposable database. The authenticated SSE adapter supports `Last-Event-ID`, rejects future/malformed cursors and requests a snapshot after a gap or more than 500 missed events.

This first transport polls the durable log once per second across instances, with a 15-second heartbeat and disconnect cleanup. LISTEN/NOTIFY fan-out, role-filtered public Board streams and site-log retention remain planned. The adapter is enabled only when an authenticated event port is configured; the unconfigured shell still reports events unavailable. This is local integration evidence, not hosted operation.
