import { createHash } from 'node:crypto';
import { Blueprint, type BlueprintInput, costDisclosure, type FreezeProof, WorkOrder } from '@stood/yard-domain';
import { YardError, type YardEvent, type YardEvents, type YardSnapshot } from '../ports/events.js';
export type Operator = Readonly<{ id: string; root: string; kind: 'BUYER' | 'BUILDER' }>;
export type SettlementProof = Readonly<{
  eventId: string;
  trancheId: string;
  packageId: string;
  reference: string;
  effect: 'CAPTURE';
  minor: number;
  currency: string;
  simulated: true;
}>;
export type PunchItem = Readonly<{ field: string; reason: string }>;
export type RefusalProof = Readonly<{
  eventId: string;
  trancheId: string;
  packageId: string;
  reference: string;
  effect: 'VOID';
  punchList: readonly PunchItem[];
  resubmissionsLeft: number;
  simulated: true;
}>;
export type HoldProof = Readonly<{
  eventId: string;
  trancheId: string;
  effect: 'HOLD';
  expiresAt: number;
  simulated: true;
}>;
export type AwaitingStood = Readonly<
  | { projectId: string; wo: string; trancheId: string; waitingFor: 'DECISION'; packageId: string }
  | { projectId: string; wo: string; trancheId: string; waitingFor: 'HOLD' }
>;
export type StoodProof = Omit<SettlementProof, 'eventId'> | Omit<RefusalProof, 'eventId'> | Omit<HoldProof, 'eventId'>;
type Refusal = Readonly<{
  eventId: string;
  packageId: string;
  reference: string;
  punchList: readonly PunchItem[];
  attempt: number;
  final: boolean;
}>;
type Action =
  | { kind: 'claim'; id: string; actor: Operator; now: number }
  | { kind: 'build'; claim: string; now: number }
  | { kind: 'submit'; claim: string; commit: string; packageId: string; now: number }
  | { kind: 'rework'; packageId: string; now: number }
  | { kind: 'expire'; now: number }
  | { kind: 'release'; claim: string; now: number }
  | { kind: 'repost'; now: number };
export type SubmissionIntent = Readonly<{
  key: string;
  actor: Operator;
  claimId: string;
  expectedVersion: number;
  reservedVersion: number;
  request: Readonly<{ trancheId: string; repository: string; baseCommit: string; commit: string; key: string }>;
  requestedAt: number;
  status: 'RESERVED' | 'CONFIRMED';
  packageId: string | null;
  completedVersion: number | null;
}>;
type Order = {
  id: string;
  milestone: string;
  trancheId: string;
  postedAt: number;
  actions: Action[];
  payment: SettlementProof | null;
  submissionIntent?: SubmissionIntent;
  pastSubmissions?: SubmissionIntent[];
  refusals?: Refusal[];
  closed?: 'REFUSED';
  holds?: { attempt: number; expiresAt: number; eventId: string }[];
  usage?: { confirmedAt: number; forwarded?: { at: number; status: 'ACCEPTED' | 'REFUSED'; reason: string | null } };
  // ADR-0027: when the capture was recorded, the buyer's dispute in the review window, and the builder's payout.
  releasedAt?: number;
  dispute?: { openedAt: number; reason: string; resolved?: { outcome: 'PAY_BUILDER' | 'REFUND_BUYER'; at: number } };
  payout?: Payout;
  // The buyer's money owed back (a dispute decided for the buyer, or a payout the owner chose not to retry). Yard's
  // owner refunds it in PayPal and records the refund's reference.
  refund?: { status: 'DUE' | 'REFUNDED'; at: number; reference?: string };
};
export type MandateRequest = Readonly<{
  payee_ref: string;
  cap: Readonly<{ minor: number; currency: string }>;
  milestones: readonly Readonly<{
    name: string;
    amount: Readonly<{ minor: number; currency: string }>;
    profile: string;
    params: Readonly<{
      repository: string;
      baseCommit: string;
      testBundleHash: string;
      manifestHash: string;
      testIds: readonly string[];
      tests?: readonly Readonly<{ id: string; path: string }>[];
    }>;
  }>[];
  window_days: number;
  max_resubmits: number;
}>;
export type MandateIntent = Readonly<{
  key: string;
  request: MandateRequest;
  reservedVersion: number;
  status: 'RESERVED' | 'CREATED';
  allowanceId: string | null;
  tranches: Readonly<Record<string, string>> | null;
  // ADR-0027: what the buyer authorizes per milestone, the builder's price plus Yard's fee on top. Absent on mandates
  // made before the fee existed (no fee).
  lines?: readonly MandateLine[];
}>;
// ADR-0027: a builder's payout, one PayPal Payouts batch per attempt. RESERVED is written before PayPal is called (the
// batch id is also PayPal-Request-Id and sender_batch_id, so a resend after a lost answer cannot pay twice); SENT once
// PayPal accepted it; then PayPal's item status: PAID_OUT, UNCLAIMED, RETURNED (unclaimed, cancelled, refunded or
// reversed: the money is back with Yard) or FAILED (never deducted). REVIEW: Yard cannot tell from PayPal whether it
// paid (no answer within the resend window, a duplicate with no link to the original, or a blocked item); the owner
// reconciles it in PayPal and records the result.
export type PayoutStatus = 'RESERVED' | 'SENT' | 'PAID_OUT' | 'UNCLAIMED' | 'RETURNED' | 'FAILED' | 'REVIEW';
export type Payout = {
  batchId: string;
  attempt: number;
  payee: string;
  builderMinor: number;
  currency: string;
  status: PayoutStatus;
  reservedAt: number;
  payoutBatchId?: string;
  reference?: string;
  reason?: string;
  settledAt?: number;
  // Earlier attempts that failed or came back, newest last.
  history?: { batchId: string; status: PayoutStatus; reference?: string }[];
};
// Third audit (2026-10-11): owner actions, so no money is ever stuck. Each is recorded with the owner's note.
export type PayoutAction =
  | Readonly<{ type: 'RESOLVE_DISPUTE'; outcome: 'PAY_BUILDER' | 'REFUND_BUYER'; note: string }>
  | Readonly<{ type: 'RETRY_PAYOUT'; payee: string; note: string }>
  | Readonly<{ type: 'REFUND_BUYER'; note: string }>
  | Readonly<{ type: 'REFUNDED'; reference: string; note: string }>
  // PAID_OUT needs PayPal's payout batch id (from the PayPal activity), so the payout stays monitored afterwards.
  | Readonly<{
      type: 'SETTLE_REVIEW';
      outcome: 'PAID_OUT' | 'NOT_SENT';
      reference: string;
      payoutBatchId?: string;
      note: string;
    }>;
// A PayPal email or a 13-character PayPal merchant id.
const payee = (v: string) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[A-Za-z]{2,24}$/.test(v) || /^[A-Z0-9]{13}$/.test(v);
const batchIdFor = (id: string, wo: string, attempt: number) =>
  `yard-${createHash('sha256')
    .update(attempt === 1 ? `${id}\0${wo}` : `${id}\0${wo}\0${attempt}`)
    .digest('hex')
    .slice(0, 40)}`;
// ADR-0027: a release on the runner's evidence alone is paid out after a 48-hour review window; the final milestone,
// released on the buyer's own confirmation of use, is paid out on release.
export const HOLDBACK_MS = 48 * 3_600_000;
export type MandateLine = Readonly<{ milestoneId: string; builderMinor: number; feeMinor: number }>;
// ADR-0027: Yard's fee, in basis points of the builder's price (500 is 5%), rounded to the nearest minor unit.
export const yardFee = (builderMinor: number, feeBps: number) => Math.round((builderMinor * feeBps) / 10_000);
export type MilestoneChange = Readonly<{ milestoneId: string; name: string; budgetMinor: number; deadline: number }>;
type ChangeOrder = {
  id: string;
  status: 'PROPOSED' | 'APPROVED';
  changes: MilestoneChange[];
  proposedAt: number;
};
type Handover = { status: 'CLOSED'; closedAt: number; confirmed: readonly string[] };
type Data = {
  blueprint: Blueprint['snapshot'];
  buyerRoot: string;
  orders: Record<string, Order>;
  handover?: Handover;
  mandate?: MandateIntent & { amendmentRequired?: string[] };
  changes?: ChangeOrder[];
  previews?: { wo: string; serviceId: string; url: string; expiresAt: number }[];
  // Fifth audit (2026-10-11): a preview deploy reserved before Render is called, so a crash leaves a trace to repair.
  previewIntents?: { wo: string; deployId: string; name: string; at: number }[];
};
// ADR-0027: when a paid work order may be paid out: at release for the final milestone, 48 hours later otherwise.
function payoutDueAt(d: Data, order: Order): number | null {
  if (!order.payment || order.releasedAt === undefined || order.refund) return null;
  // A dispute holds the payout until the owner decides it for the builder; then it is due at once.
  if (order.dispute) return order.dispute.resolved?.outcome === 'PAY_BUILDER' ? order.dispute.resolved.at : null;
  const final = terms(d, order.milestone)?.profileId === 'code.final@1';
  return final ? order.releasedAt : order.releasedAt + HOLDBACK_MS;
}
// Effective milestone terms: the immutable signed milestone with approved change orders applied in order.
function terms(d: Data, milestoneId: string) {
  const base = d.blueprint.milestones.find((m) => m.id === milestoneId);
  if (!base) return undefined;
  let effective = { ...base };
  for (const order of d.changes ?? [])
    if (order.status === 'APPROVED')
      for (const c of order.changes)
        if (c.milestoneId === milestoneId)
          effective = { ...effective, name: c.name, budgetMinor: c.budgetMinor, deadline: c.deadline };
  return effective;
}
const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// The public Board identity of a posted work order (no buyer data).
export const offerId = (projectId: string, workOrderId: string) => fingerprint({ projectId, workOrderId });
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, v]) => [key, canonical(v)]),
    );
  return value;
}
const same = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
function data(value: unknown): Data {
  const d = value as Data;
  if (
    !d ||
    typeof d !== 'object' ||
    !d.blueprint ||
    typeof d.buyerRoot !== 'string' ||
    !d.buyerRoot ||
    !d.orders ||
    typeof d.orders !== 'object' ||
    Array.isArray(d.orders)
  )
    throw new YardError('INVALID');
  const bp = Blueprint.create(d.blueprint);
  if (d.blueprint.version !== 1 || (d.blueprint.status !== 'DRAFT' && d.blueprint.status !== 'FROZEN'))
    throw new YardError('INVALID');
  if (d.blueprint.status === 'FROZEN') {
    if (!d.blueprint.termsProof) throw new YardError('INVALID');
    bp.freezeTerms(d.blueprint.termsProof);
  }
  return structuredClone(d);
}
function leaseChange(change: () => void): void {
  try {
    change();
  } catch (error) {
    throw new YardError(error instanceof RangeError ? 'INVALID' : 'CONFLICT');
  }
}
function workOrder(d: Data, id: string): { order: Order; work: WorkOrder } {
  if (!Object.hasOwn(d.orders, id)) throw new YardError('NOT_FOUND');
  const order = d.orders[id]!;
  const work = new WorkOrder(order.id, d.buyerRoot, order.postedAt);
  for (const a of order.actions) {
    switch (a.kind) {
      case 'claim':
        work.claim({ id: a.id, builderId: a.actor.id, operatorId: a.actor.id, operatorRootId: a.actor.root }, a.now);
        break;
      case 'build':
        work.build(a.claim, a.now);
        break;
      case 'submit':
        work.submit(a.claim, a.commit, a.packageId, a.now);
        work.checking(a.packageId, a.now);
        break;
      case 'rework':
        work.rework(a.packageId, a.now);
        break;
      case 'expire':
        work.expire(a.now);
        break;
      case 'release':
        work.release(a.claim, a.now);
        break;
      case 'repost':
        work.repost(a.now);
        break;
      default:
        throw new YardError('INVALID');
    }
  }
  return { order, work };
}
function beforeDeadline(d: Data, milestoneId: string, now: number): void {
  if (!Number.isSafeInteger(now) || now < d.blueprint.createdAt) throw new YardError('INVALID');
  const milestone = terms(d, milestoneId);
  if (!milestone) throw new YardError('INVALID');
  if (now >= milestone.deadline) throw new YardError('CONFLICT');
}
function open(order: Order): void {
  if (order.payment || order.closed) throw new YardError('CONFLICT');
}
const field = /^[a-z][a-z0-9_]{0,63}$/;
function punchList(value: unknown): readonly PunchItem[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) throw new YardError('INVALID');
  return Object.freeze(
    value.map((item) => {
      const i = item as Record<string, unknown>;
      if (
        !i ||
        typeof i !== 'object' ||
        Object.keys(i).sort().join() !== 'field,reason' ||
        typeof i.field !== 'string' ||
        !field.test(i.field) ||
        typeof i.reason !== 'string' ||
        !i.reason.trim() ||
        i.reason.length > 300
      )
        throw new YardError('INVALID');
      return Object.freeze({ field: i.field, reason: i.reason });
    }),
  );
}
// The confirmed Stood hold for the work order's current attempt, if any. Never a payment.
function currentHold(order: Order, work: WorkOrder) {
  return order.holds?.find((h) => h.attempt === work.snapshot.attempt) ?? null;
}
function status(order: Order, work: WorkOrder): string {
  if (order.payment) return 'PAID';
  if (order.closed) return order.closed;
  if (order.submissionIntent?.status === 'RESERVED') return 'SUBMITTING';
  return work.snapshot.state;
}
function feedback(order: Order) {
  const last = order.refusals?.at(-1);
  return {
    punchList: order.payment || !last ? null : last.punchList,
    refusals: (order.refusals ?? []).map((r) => ({
      packageId: r.packageId,
      reference: r.reference,
      attempt: r.attempt,
      final: r.final,
    })),
  };
}
const BUILDER_EVENTS = new Set([
  'wo.claimed',
  'stood.held',
  'wo.building',
  'submission.reserved',
  'wo.submitted',
  'wo.lease_expired',
  'wo.released_claim',
  'stood.released',
  'stood.refused',
]);
// Y13: one operator root cannot squat the Board. Checked before claiming; replays are unaffected.
export const MAX_ACTIVE_CLAIMS = 2;
export class Board {
  constructor(
    readonly events: YardEvents,
    private readonly limits: Readonly<{ maxActiveClaims: number; payee?: string; feeBps?: number }> = {
      maxActiveClaims: MAX_ACTIVE_CLAIMS,
    },
  ) {}
  // Active, unexpired leases held by an operator root across every project (paged).
  async activeClaims(root: string, now: number, except?: Readonly<{ id: string; wo: string }>): Promise<number> {
    let count = 0;
    let after = '';
    do {
      const projects = await this.events.list(after);
      const page = projects.slice(0, 100);
      for (const p of page) {
        const d = data(p.data);
        for (const wo of Object.keys(d.orders)) {
          if (except && p.id === except.id && wo === except.wo) continue;
          const { work, order } = workOrder(d, wo);
          const claim = work.snapshot.currentClaim;
          if (claim?.operatorRootId === root && now < claim.leasedUntil && !order.payment && !order.closed) count++;
        }
      }
      after = projects.length > 100 ? (page.at(-1)?.id ?? '') : '';
    } while (after);
    return count;
  }
  async create(input: BlueprintInput, actor: Operator, key: string): Promise<YardSnapshot> {
    if (actor.kind !== 'BUYER' || input.buyerOperatorId !== actor.id) throw new YardError('FORBIDDEN');
    if (
      ![input.id, ...input.milestones.map((m) => m.id)].every(
        (id) => /^[A-Za-z0-9_-]{1,100}$/.test(id) && !['__proto__', 'constructor', 'prototype'].includes(id),
      )
    )
      throw new YardError('INVALID');
    return this.events.create(
      input.id,
      actor.id,
      { blueprint: Blueprint.create(input).snapshot, buyerRoot: actor.root, orders: {} },
      key,
    );
  }
  async read(id: string, actor: Operator): Promise<YardSnapshot> {
    const snapshot = await this.events.load(id),
      d = data(snapshot.data);
    if (
      snapshot.owner !== actor.id &&
      !Object.keys(d.orders).some((wo) => workOrder(d, wo).work.snapshot.currentClaim?.builderId === actor.id)
    )
      throw new YardError('FORBIDDEN');
    return snapshot;
  }
  // Metadata only (name, provider, environment, version). The viewer filter keeps it buyer-only.
  async secretEvent(
    id: string,
    actor: Operator,
    key: string,
    type: 'secret.added' | 'secret.revoked',
    payload: Readonly<{ name: string; provider?: string; environment?: string; version?: number }>,
  ) {
    for (let attempt = 0; ; attempt++) {
      const snapshot = await this.events.load(id);
      try {
        return await this.events.mutate(
          id,
          snapshot.version,
          actor.id,
          `${type}:${key}`,
          fingerprint(payload),
          (raw) => ({
            data: data(raw),
            type,
            payload: { ...payload, simulated: true },
          }),
        );
      } catch (error) {
        if (attempt > 0 || !(error instanceof YardError) || error.code !== 'STALE_VERSION') throw error;
      }
    }
  }
  // Y18 §5: the owning buyer sees every project event; a builder sees only build events for work it holds now.
  async viewer(id: string, actor: Operator): Promise<{ see(event: YardEvent): boolean }> {
    const snapshot = await this.read(id, actor),
      d = data(snapshot.data);
    if (actor.kind === 'BUYER' && snapshot.owner === actor.id && d.buyerRoot === actor.root) return { see: () => true };
    const held = new Set(
      Object.keys(d.orders).filter((wo) => {
        const claim = workOrder(d, wo).work.snapshot.currentClaim;
        return actor.kind === 'BUILDER' && claim?.builderId === actor.id && claim.operatorRootId === actor.root;
      }),
    );
    if (!held.size) throw new YardError('FORBIDDEN');
    return {
      see: (event) => {
        const wo = (event.payload as { wo?: unknown } | null)?.wo;
        return BUILDER_EVENTS.has(event.type) && typeof wo === 'string' && held.has(wo);
      },
    };
  }
  logScope(snapshot: YardSnapshot, wo: string, actor: Operator, now: number, write: boolean): void {
    if (!Number.isSafeInteger(now) || now < 0) throw new YardError('INVALID');
    const d = data(snapshot.data),
      { work, order } = workOrder(d, wo),
      claim = work.snapshot.currentClaim;
    if (!write && actor.kind === 'BUYER' && snapshot.owner === actor.id && d.buyerRoot === actor.root) return;
    if (actor.kind !== 'BUILDER' || !claim || claim.builderId !== actor.id || claim.operatorRootId !== actor.root)
      throw new YardError('FORBIDDEN');
    if (write) {
      beforeDeadline(d, order.milestone, now);
      if (
        now < claim.claimedAt ||
        now >= claim.leasedUntil ||
        order.payment ||
        order.closed ||
        order.submissionIntent?.status === 'RESERVED' ||
        !['CLAIMED', 'BUILDING', 'REWORK'].includes(work.snapshot.state)
      )
        throw new YardError('CONFLICT');
    }
  }
  // T-0196: preview targets for a submitted milestone. Previews run test data only and expire.
  async previewTarget(id: string, wo: string, now: number) {
    const snapshot = await this.events.load(id),
      d = data(snapshot.data);
    const { work, order } = workOrder(d, wo);
    if (!['CHECKING', 'REWORK'].includes(work.snapshot.state) && !order.payment) throw new YardError('CONFLICT');
    return { owner: snapshot.owner, expiresAt: order.payment ? now + 7 * 86400000 : now + 30 * 86400000 };
  }
  // One deploy at a time per work order: the reservation is a version-checked write, so of two racing requests one
  // reserves and the other sees it (CONFLICT). A live preview is reused by the caller before it reserves.
  async reservePreview(id: string, intent: { wo: string; deployId: string; name: string; at: number }, now: number) {
    // Another write to the project between load and mutate (a racing deploy among them) is retried on the new
    // version, where the racing reservation, if any, is seen.
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.reserveOnce(id, intent, now);
      } catch (error) {
        if (!(error instanceof YardError) || error.code !== 'STALE_VERSION' || attempt === 5) throw error;
      }
    }
  }
  private async reserveOnce(
    id: string,
    intent: { wo: string; deployId: string; name: string; at: number },
    now: number,
  ) {
    const snapshot = await this.events.load(id);
    return this.events.mutate(
      id,
      snapshot.version,
      'yard',
      `preview-intent:${intent.deployId}`,
      fingerprint(intent),
      (raw) => {
        const d = data(raw);
        workOrder(d, intent.wo);
        if (
          (d.previews ?? []).some((p) => p.wo === intent.wo && p.expiresAt > now) ||
          (d.previewIntents ?? []).some((p) => p.wo === intent.wo)
        )
          throw new YardError('CONFLICT');
        d.previewIntents = [...(d.previewIntents ?? []), structuredClone(intent)];
        return { data: d, type: 'preview.reserved', payload: { wo: intent.wo, simulated: true } };
      },
    );
  }
  async releasePreview(id: string, deployId: string, reason: 'failed' | 'abandoned') {
    const snapshot = await this.events.load(id);
    return this.events.mutate(
      id,
      snapshot.version,
      'yard',
      `preview-released:${deployId}`,
      fingerprint({ deployId, reason }),
      (raw) => {
        const d = data(raw);
        const p = d.previewIntents?.find((x) => x.deployId === deployId);
        if (!p) throw new YardError('NOT_FOUND');
        d.previewIntents = d.previewIntents?.filter((x) => x.deployId !== deployId) ?? [];
        return { data: d, type: 'preview.released', payload: { wo: p.wo, reason, simulated: true } };
      },
    );
  }
  async previewIntents(id: string) {
    return structuredClone(data((await this.events.load(id)).data).previewIntents ?? []);
  }
  async recordPreview(
    id: string,
    preview: { wo: string; serviceId: string; url: string; expiresAt: number },
    deployId?: string,
  ) {
    const snapshot = await this.events.load(id);
    return this.events.mutate(
      id,
      snapshot.version,
      'yard',
      `preview:${preview.serviceId}`,
      fingerprint(preview),
      (raw) => {
        const d = data(raw);
        workOrder(d, preview.wo);
        if (deployId) d.previewIntents = d.previewIntents?.filter((x) => x.deployId !== deployId) ?? [];
        d.previews = [...(d.previews ?? []), structuredClone(preview)];
        return {
          data: d,
          type: 'preview.deployed',
          payload: { wo: preview.wo, url: preview.url, expiresAt: preview.expiresAt, simulated: true },
        };
      },
    );
  }
  async removePreview(id: string, serviceId: string, reason: 'expired' | 'closed') {
    const snapshot = await this.events.load(id);
    return this.events.mutate(
      id,
      snapshot.version,
      'yard',
      `preview-removed:${serviceId}`,
      fingerprint({ serviceId, reason }),
      (raw) => {
        const d = data(raw);
        const p = d.previews?.find((x) => x.serviceId === serviceId);
        if (!p) throw new YardError('NOT_FOUND');
        d.previews = d.previews?.filter((x) => x.serviceId !== serviceId) ?? [];
        return { data: d, type: 'preview.expired', payload: { wo: p.wo, reason, simulated: true } };
      },
    );
  }
  async previewList(id: string) {
    return structuredClone(data((await this.events.load(id)).data).previews ?? []);
  }
  // T-0213: notices derived from project events after a cursor, plus lease-ending reminders.
  // Recipients are actor ids; amounts go only to the payer and payee of that milestone.
  async notices(id: string, after: number, now: number) {
    const snapshot = await this.events.load(id),
      d = data(snapshot.data);
    const out: { key: string; actor: string; subject: string; text: string }[] = [];
    const name = (wo: string) => {
      const order = d.orders[wo];
      return order ? (terms(d, order.milestone)?.name ?? wo) : wo;
    };
    const claimant = (wo: string) =>
      Object.hasOwn(d.orders, wo) ? workOrder(d, wo).work.snapshot.currentClaim?.builderId : undefined;
    const money = (minor: number) =>
      new Intl.NumberFormat('en', { style: 'currency', currency: d.blueprint.currency }).format(minor / 100);
    const events = await this.events.read(id, after);
    for (const e of events) {
      const p = (e.payload ?? {}) as Record<string, unknown>;
      const wo = typeof p.wo === 'string' ? p.wo : '';
      if (e.type === 'stood.refused' && wo) {
        const items = (Array.isArray(p.punchList) ? p.punchList : []) as { field: string; reason: string }[];
        const builder = claimant(wo);
        if (builder)
          out.push({
            key: `${id}:${e.seq}:builder`,
            actor: builder,
            subject: `Not yet: punch list for "${name(wo)}"`,
            text: [
              `Not yet. ${items.length} named ${items.length === 1 ? 'check' : 'checks'} failed:`,
              ...items.map((i) => `- ${i.field}: ${i.reason}`),
              'Nothing was paid.',
              p.state === 'REWORK'
                ? 'Fix it and resubmit on the same lease.'
                : 'No attempts are left on this milestone.',
            ].join('\n'),
          });
      } else if (e.type === 'stood.released' && wo) {
        const amount = money(Number((p.payment as { minor?: number } | undefined)?.minor ?? 0));
        const text = `${amount} released for "${name(wo)}". Stood checked it. Simulated: no real money moved.`;
        out.push({
          key: `${id}:${e.seq}:buyer`,
          actor: snapshot.owner,
          subject: `Milestone paid: "${name(wo)}"`,
          text,
        });
        const builder = claimant(wo);
        if (builder)
          out.push({ key: `${id}:${e.seq}:builder`, actor: builder, subject: `Milestone paid: "${name(wo)}"`, text });
      } else if (e.type === 'blueprint.closed')
        out.push({
          key: `${id}:${e.seq}:buyer`,
          actor: snapshot.owner,
          subject: 'Project closed',
          text: 'Closed. The keys are yours. Stored test keys are deleted within seven days.',
        });
    }
    for (const wo of Object.keys(d.orders)) {
      const { work, order } = workOrder(d, wo),
        claim = work.snapshot.currentClaim;
      if (
        claim &&
        !order.payment &&
        !order.closed &&
        ['CLAIMED', 'BUILDING', 'REWORK'].includes(work.snapshot.state) &&
        now >= claim.leasedUntil - 6 * 3600000 &&
        now < claim.leasedUntil
      )
        out.push({
          key: `${id}:${wo}:${claim.id}:lease-ending`,
          actor: claim.builderId,
          subject: `Lease ending soon: "${name(wo)}"`,
          text: `Your lease on "${name(wo)}" ends ${new Date(claim.leasedUntil).toISOString().slice(0, 16).replace('T', ' ')} UTC. Submit or clock out before then.`,
        });
    }
    return { notices: out, lastSeq: events.at(-1)?.seq ?? after };
  }
  // Y13: reputation counts only Stood-paid milestones for buyers outside the builder's operator tree.
  async reputation(root: string) {
    const result = { root, counted: 0, selfDealing: 0, refusals: 0 };
    let after = '';
    do {
      const projects = await this.events.list(after);
      const page = projects.slice(0, 100);
      for (const p of page) {
        const d = data(p.data);
        for (const wo of Object.keys(d.orders)) {
          const { work, order } = workOrder(d, wo);
          const claim = work.snapshot.currentClaim;
          if (!claim || claim.operatorRootId !== root) continue;
          result.refusals += order.refusals?.length ?? 0;
          if (order.payment) {
            if (claim.outsideOperator) result.counted++;
            else result.selfDealing++;
          }
        }
      }
      after = projects.length > 100 ? (page.at(-1)?.id ?? '') : '';
    } while (after);
    return result;
  }
  // The buyer, an outside authority, confirms use of the delivered product for the final milestone.
  confirmUsage(id: string, actor: Operator, version: number, key: string, now: number, wo: string) {
    return this.mutate(id, actor, version, key, { usage: wo }, 'usage.confirmed', (d) => {
      if (actor.kind !== 'BUYER' || d.blueprint.buyerOperatorId !== actor.id || d.buyerRoot !== actor.root)
        throw new YardError('FORBIDDEN');
      const { order } = workOrder(d, wo);
      if (terms(d, order.milestone)?.profileId !== 'code.final@1' || !Number.isSafeInteger(now))
        throw new YardError('INVALID');
      if (order.usage || order.closed) throw new YardError('CONFLICT');
      order.usage = { confirmedAt: now };
      return { wo, confirmedAt: now, simulated: true };
    });
  }
  // T-0212: a change order proposes new terms for unposted milestones; the signed snapshot never changes.
  proposeChange(
    id: string,
    actor: Operator,
    version: number,
    key: string,
    now: number,
    changes: readonly MilestoneChange[],
  ) {
    return this.mutate(id, actor, version, key, { changes }, 'blueprint.change_proposed', (d) => {
      if (actor.kind !== 'BUYER' || d.blueprint.buyerOperatorId !== actor.id || d.buyerRoot !== actor.root)
        throw new YardError('FORBIDDEN');
      if (d.blueprint.status !== 'FROZEN' || d.handover || d.changes?.some((c) => c.status === 'PROPOSED'))
        throw new YardError('CONFLICT');
      if (!Array.isArray(changes) || changes.length < 1 || changes.length > d.blueprint.milestones.length)
        throw new YardError('INVALID');
      const ids = changes.map((c) => c?.milestoneId);
      if (new Set(ids).size !== ids.length) throw new YardError('INVALID');
      let before = 0;
      let after = 0;
      for (const c of changes) {
        const current = typeof c?.milestoneId === 'string' ? terms(d, c.milestoneId) : undefined;
        if (
          !current ||
          Object.keys(c).sort().join() !== 'budgetMinor,deadline,milestoneId,name' ||
          typeof c.name !== 'string' ||
          !c.name.trim() ||
          c.name.length > 200 ||
          !Number.isSafeInteger(c.budgetMinor) ||
          c.budgetMinor < 1 ||
          !Number.isSafeInteger(c.deadline) ||
          c.deadline <= now ||
          c.deadline <= d.blueprint.createdAt
        )
          throw new YardError('INVALID');
        if (Object.hasOwn(d.orders, c.milestoneId)) throw new YardError('CONFLICT');
        before += current.budgetMinor;
        after += c.budgetMinor;
      }
      // The signed cap never moves: changed milestones keep their combined budget.
      if (before !== after) throw new YardError('INVALID');
      const changeId = `change-${(d.changes?.length ?? 0) + 1}`;
      d.changes = [
        ...(d.changes ?? []),
        { id: changeId, status: 'PROPOSED', changes: structuredClone([...changes]), proposedAt: now },
      ];
      return { changeId, milestones: ids, simulated: true };
    });
  }
  approveChange(id: string, actor: Operator, version: number, key: string, changeId: string) {
    return this.mutate(id, actor, version, key, { approve: changeId }, 'blueprint.change_approved', (d) => {
      if (actor.kind !== 'BUYER' || d.blueprint.buyerOperatorId !== actor.id || d.buyerRoot !== actor.root)
        throw new YardError('FORBIDDEN');
      const order = d.changes?.find((c) => c.id === changeId);
      if (!order || order.status !== 'PROPOSED' || order.changes.some((c) => Object.hasOwn(d.orders, c.milestoneId)))
        throw new YardError('CONFLICT');
      order.status = 'APPROVED';
      const changed = order.changes.map((c) => c.milestoneId);
      if (d.mandate?.status === 'CREATED')
        d.mandate.amendmentRequired = [...new Set([...(d.mandate.amendmentRequired ?? []), ...changed])];
      return { changeId, milestones: changed, amendmentRequired: d.mandate?.status === 'CREATED', simulated: true };
    });
  }
  // T-0184: reserve the exact allowance request derived from the frozen terms before any Stood call.
  async prepareMandate(id: string, actor: Operator, version: number, key: string, now: number): Promise<MandateIntent> {
    const current = await this.events.load(id);
    const existing = data(current.data).mandate;
    if (existing) {
      if (existing.key !== `yard-mandate:${fingerprint({ id, actor, key })}`) throw new YardError('CONFLICT');
      return structuredClone(existing);
    }
    const snapshot = await this.mutate(
      id,
      actor,
      version,
      `mandate-reserve:${key}`,
      { key },
      'stood.allowance_reserved',
      (d) => {
        if (actor.kind !== 'BUYER' || d.blueprint.buyerOperatorId !== actor.id || d.buyerRoot !== actor.root)
          throw new YardError('FORBIDDEN');
        if (d.blueprint.status !== 'FROZEN' || d.mandate || !Number.isSafeInteger(now) || now < d.blueprint.createdAt)
          throw new YardError('CONFLICT');
        const effective = d.blueprint.milestones.map((m) => terms(d, m.id) ?? m);
        const latest = Math.max(...effective.map((m) => m.deadline));
        // ADR-0027: the buyer pays Yard's fee on top of each milestone, in the same hold, so a refusal voids both and
        // the builder receives exactly their price.
        const feeBps = this.limits.feeBps ?? 0;
        const lines = effective.map((m) => ({
          milestoneId: m.id,
          builderMinor: m.budgetMinor,
          feeMinor: yardFee(m.budgetMinor, feeBps),
        }));
        const hold = (i: number) => (lines[i] as MandateLine).builderMinor + (lines[i] as MandateLine).feeMinor;
        const days = Math.min(28, Math.max(1, Math.ceil((latest - now) / 86400000)));
        const request: MandateRequest = {
          // ADR-0027: Yard's PayPal merchant receives the capture; builders are paid out after release. Without a
          // configured merchant (local simulations) the payee is a project reference only a simulator accepts.
          payee_ref: this.limits.payee ?? `yard:${id}`,
          // Stood's cap covers the milestones as the buyer authorizes them: each builder price plus Yard's fee.
          cap: {
            minor: effective.reduce((n, _m, i) => n + hold(i), 0),
            currency: d.blueprint.currency,
          },
          milestones: effective.map((m, i) => ({
            name: m.name,
            amount: { minor: hold(i), currency: d.blueprint.currency },
            profile: m.profileId,
            // T-0159: the frozen code terms Stood checks and later binds the runner and verifier to.
            params: {
              repository: d.blueprint.repository,
              baseCommit: d.blueprint.baseCommit,
              testBundleHash: m.testBundleHash,
              manifestHash: m.manifestHash,
              testIds: [...m.testIds],
              ...(m.tests ? { tests: m.tests.map((t) => ({ id: t.id, path: t.path })) } : {}),
            },
          })),
          window_days: days,
          max_resubmits: 1,
        };
        d.mandate = {
          key: `yard-mandate:${fingerprint({ id, actor, key })}`,
          request,
          reservedVersion: version + 1,
          status: 'RESERVED',
          allowanceId: null,
          tranches: null,
          lines,
        };
        return { state: 'RESERVED', simulated: true };
      },
    );
    return structuredClone(data(snapshot.data).mandate as MandateIntent);
  }
  completeMandate(
    id: string,
    intent: MandateIntent,
    draft: Readonly<{ id: string; tranches: readonly Readonly<{ id: string; name: string }>[] }>,
  ) {
    return this.atCurrent(id, (version) =>
      this.events.mutate(id, version, 'stood', `mandate-complete:${intent.key}`, fingerprint({ draft }), (raw) => {
        const d = data(raw);
        if (
          !same(d.mandate, intent) ||
          typeof draft.id !== 'string' ||
          !draft.id.trim() ||
          draft.tranches.length !== intent.request.milestones.length ||
          draft.tranches.some((t, i) => !t.id?.trim() || t.name !== intent.request.milestones[i]?.name)
        )
          throw new YardError('INVALID');
        const tranches = Object.fromEntries(
          d.blueprint.milestones.map((m, i) => [m.id, draft.tranches[i]?.id as string]),
        );
        d.mandate = { ...intent, status: 'CREATED', allowanceId: draft.id, tranches };
        return {
          data: d,
          type: 'stood.allowance_created',
          payload: { allowanceId: draft.id, milestones: Object.keys(tranches), simulated: true },
        };
      }),
    );
  }
  async pendingMandates(after = '') {
    const projects = await this.events.list(after),
      page = projects.slice(0, 100);
    return {
      mandates: page.flatMap((p) => {
        const m = data(p.data).mandate;
        return m?.status === 'RESERVED' ? [{ projectId: p.id, intent: structuredClone(m) }] : [];
      }),
      nextCursor: projects.length > 100 ? (page.at(-1)?.id ?? null) : null,
    };
  }
  // Y20 §5: the buyer confirms their rotation items once every milestone is paid. This closes the
  // project; it never changes or waits for a Stood money decision.
  closeHandover(id: string, actor: Operator, version: number, key: string, now: number, confirmed: readonly string[]) {
    return this.mutate(id, actor, version, key, { handover: confirmed }, 'blueprint.closed', (d) => {
      if (actor.kind !== 'BUYER' || d.blueprint.buyerOperatorId !== actor.id || d.buyerRoot !== actor.root)
        throw new YardError('FORBIDDEN');
      if (!Number.isSafeInteger(now) || now < d.blueprint.createdAt) throw new YardError('INVALID');
      if (
        d.handover ||
        d.blueprint.status !== 'FROZEN' ||
        d.blueprint.milestones.some((m) => !Object.hasOwn(d.orders, m.id) || !d.orders[m.id]?.payment)
      )
        throw new YardError('CONFLICT');
      d.handover = { status: 'CLOSED', closedAt: now, confirmed: [...confirmed] };
      return { state: 'CLOSED', confirmed: [...confirmed], simulated: true };
    });
  }
  // Step 9 keys: only the owning buyer, and only after the blueprint terms are signed (frozen).
  // Data export for the owning buyer only (T-0217): the room plus every project event, read in pages.
  async exportFor(id: string, actor: Operator, now: number) {
    const snapshot = await this.events.load(id),
      d = data(snapshot.data);
    if (actor.kind !== 'BUYER' || snapshot.owner !== actor.id || d.buyerRoot !== actor.root)
      throw new YardError('FORBIDDEN');
    const events: YardEvent[] = [];
    for (let page = await this.events.read(id, 0); page.length; page = await this.events.read(id, events.at(-1)!.seq)) {
      events.push(...page);
      if (events.length >= snapshot.version) break;
    }
    return { room: await this.room(id, actor, now), events };
  }
  async secretScope(id: string, actor: Operator): Promise<void> {
    const snapshot = await this.events.load(id),
      d = data(snapshot.data);
    if (actor.kind !== 'BUYER' || snapshot.owner !== actor.id || d.buyerRoot !== actor.root)
      throw new YardError('FORBIDDEN');
    if (d.blueprint.status !== 'FROZEN') throw new YardError('CONFLICT');
  }
  async discover(now: number) {
    return (await this.discoverPage('', now)).orders;
  }
  async discoverPage(after: string = '', now: number, query?: string) {
    if (!Number.isSafeInteger(now) || now < 0) throw new YardError('INVALID');
    if (after && !/^[A-Za-z0-9_-]{1,100}$/.test(after)) throw new YardError('INVALID');
    const q = query?.trim();
    if (q !== undefined && (!q || q.length > 100)) throw new YardError('INVALID');
    const words = q?.toLowerCase().split(/\s+/) ?? [];
    const projects = q
      ? this.events.search
        ? await this.events.search(q, after)
        : (await this.events.list(after)).filter(() => true)
      : await this.events.list(after);
    const page = projects.slice(0, 100);
    const orders = page.flatMap((s) => {
      const d = data(s.data);
      return Object.keys(d.orders).flatMap((id) => {
        const { work, order } = workOrder(d, id);
        const milestone = terms(d, order.milestone)!;
        const tokens = milestone.name.toLowerCase().split(/[^a-z0-9]+/);
        if (
          (q && !words.every((w) => tokens.includes(w))) ||
          order.payment ||
          order.closed ||
          work.snapshot.state !== 'POSTED' ||
          now < d.blueprint.createdAt ||
          now >= milestone.deadline
        )
          return [];
        return [
          {
            projectId: s.id,
            id: offerId(s.id, id),
            workOrderId: id,
            name: milestone.name,
            priceMinor: milestone.budgetMinor,
            deadline: milestone.deadline,
            currency: d.blueprint.currency,
            profile: milestone.profileId,
            version: s.version,
            simulated: true,
          },
        ];
      });
    });
    return { orders, nextCursor: projects.length > 100 ? page.at(-1)!.id : null };
  }
  // Sixth audit (2026-10-11): completing a reserved intent must survive unrelated writes to the project. The write
  // goes against the current version (its own check proves the intent is unchanged) and retries on a newer one; a
  // replay of the same key returns the first result before any version is compared.
  private async atCurrent<T>(id: string, write: (version: number) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await write((await this.events.load(id)).version);
      } catch (error) {
        if (!(error instanceof YardError) || error.code !== 'STALE_VERSION' || attempt === 5) throw error;
      }
    }
  }
  private async mutate(
    id: string,
    actor: Operator,
    version: number,
    key: string,
    command: unknown,
    type: string,
    change: (d: Data) => unknown,
  ) {
    return this.events.mutate(id, version, actor.id, key, fingerprint({ actor, command }), (raw) => {
      const d = data(raw);
      const payload = change(d);
      return { data: d, type, payload };
    });
  }
  freeze(id: string, proof: FreezeProof, actor: Operator, version: number, key: string) {
    return this.mutate(id, actor, version, key, { freeze: proof }, 'blueprint.approved', (d) => {
      if (actor.kind !== 'BUYER' || d.blueprint.buyerOperatorId !== actor.id) throw new YardError('FORBIDDEN');
      d.blueprint = Blueprint.create(d.blueprint).freezeTerms(proof).snapshot;
      return { id, simulated: true, authority: 'local-terms-only' };
    });
  }
  post(
    id: string,
    milestone: string,
    requested: string | undefined,
    actor: Operator,
    version: number,
    key: string,
    now: number,
  ) {
    return this.mutate(id, actor, version, key, { post: milestone, trancheId: requested ?? null }, 'wo.posted', (d) => {
      // Once Stood has created the allowance, its tranche is the only one this milestone can use.
      const mapped = d.mandate?.status === 'CREATED' ? d.mandate.tranches?.[milestone] : undefined;
      if (mapped && requested !== undefined && requested !== mapped) throw new YardError('INVALID');
      const trancheId = mapped ?? requested ?? '';
      // A change approved after the Stood allowance exists needs a Stood amendment first.
      if (d.mandate?.amendmentRequired?.includes(milestone)) throw new YardError('CONFLICT');
      if (actor.kind !== 'BUYER' || d.blueprint.buyerOperatorId !== actor.id) throw new YardError('FORBIDDEN');
      if (
        d.blueprint.status !== 'FROZEN' ||
        !d.blueprint.milestones.some((m) => m.id === milestone) ||
        Object.hasOwn(d.orders, milestone) ||
        !/^[A-Za-z0-9_-]{1,200}$/.test(trancheId)
      )
        throw new YardError('INVALID');
      beforeDeadline(d, milestone, now);
      const work = new WorkOrder(milestone, actor.root, now);
      d.orders[milestone] = { id: work.snapshot.id, milestone, trancheId, postedAt: now, actions: [], payment: null };
      return { wo: milestone, state: 'POSTED', simulated: true };
    });
  }
  async claim(id: string, wo: string, actor: Operator, version: number, key: string, now: number) {
    const current = await this.events.load(id);
    const existing = Object.hasOwn(data(current.data).orders, wo)
      ? workOrder(data(current.data), wo).work.snapshot.currentClaim
      : null;
    // A replay of this builder's own claim is not a new claim; anything else counts against the cap.
    if (
      existing?.builderId !== actor.id &&
      (await this.activeClaims(actor.root, now, { id, wo })) >= this.limits.maxActiveClaims
    )
      throw new YardError('CONFLICT');
    return this.mutate(id, actor, version, key, { claim: wo }, 'wo.claimed', (d) => {
      if (actor.kind !== 'BUILDER') throw new YardError('FORBIDDEN');
      const { work, order } = workOrder(d, wo);
      open(order);
      beforeDeadline(d, order.milestone, now);
      const claimId = fingerprint({ id, wo, actor: actor.id, key });
      const claim = work.claim(
        { id: claimId, builderId: actor.id, operatorId: actor.id, operatorRootId: actor.root },
        now,
      );
      order.actions.push({ kind: 'claim', id: claim.id, actor, now });
      return { wo, claimId, leasedUntil: claim.leasedUntil, simulated: true };
    });
  }
  build(id: string, wo: string, actor: Operator, version: number, key: string, now: number) {
    return this.mutate(id, actor, version, key, { build: wo }, 'wo.building', (d) => {
      const { work, order } = workOrder(d, wo);
      const claim = work.snapshot.currentClaim;
      if (actor.kind !== 'BUILDER' || claim?.builderId !== actor.id) throw new YardError('FORBIDDEN');
      open(order);
      beforeDeadline(d, order.milestone, now);
      // Work starts only against a confirmed, unexpired Stood hold for this attempt.
      const hold = currentHold(order, work);
      if (!hold || now >= hold.expiresAt) throw new YardError('CONFLICT');
      leaseChange(() => work.build(claim.id, now));
      order.actions.push({ kind: 'build', claim: claim.id, now });
      return { wo, state: 'BUILDING', simulated: true };
    });
  }
  expireLease(id: string, wo: string, actor: Operator, version: number, key: string, now: number) {
    return this.mutate(id, actor, version, key, { expire: wo }, 'wo.lease_expired', (d) => {
      if (actor.kind !== 'BUYER' || d.blueprint.buyerOperatorId !== actor.id) throw new YardError('FORBIDDEN');
      const { work, order } = workOrder(d, wo);
      if (order.payment || order.closed || order.submissionIntent?.status === 'RESERVED')
        throw new YardError('CONFLICT');
      leaseChange(() => work.expire(now));
      order.actions.push({ kind: 'expire', now });
      return { wo, state: 'LEASE_EXPIRED', simulated: true };
    });
  }
  releaseClaim(id: string, wo: string, actor: Operator, version: number, key: string, now: number) {
    return this.mutate(id, actor, version, key, { release: wo }, 'wo.released_claim', (d) => {
      const { work, order } = workOrder(d, wo),
        claim = work.snapshot.currentClaim;
      if (actor.kind !== 'BUILDER' || claim?.builderId !== actor.id) throw new YardError('FORBIDDEN');
      if (order.payment || order.closed || order.submissionIntent?.status === 'RESERVED')
        throw new YardError('CONFLICT');
      leaseChange(() => work.release(claim.id, now));
      order.actions.push({ kind: 'release', claim: claim.id, now });
      return { wo, state: 'ABANDONED', simulated: true };
    });
  }
  repost(id: string, wo: string, actor: Operator, version: number, key: string, now: number) {
    return this.mutate(id, actor, version, key, { repost: wo }, 'wo.reposted', (d) => {
      if (actor.kind !== 'BUYER' || d.blueprint.buyerOperatorId !== actor.id) throw new YardError('FORBIDDEN');
      const { work, order } = workOrder(d, wo);
      if (order.payment || order.closed || order.submissionIntent?.status === 'RESERVED')
        throw new YardError('CONFLICT');
      beforeDeadline(d, order.milestone, now);
      leaseChange(() => work.repost(now));
      order.actions.push({ kind: 'repost', now });
      return { wo, state: 'POSTED', simulated: true };
    });
  }
  submit(
    id: string,
    wo: string,
    commit: string,
    packageId: string,
    actor: Operator,
    version: number,
    key: string,
    now: number,
  ) {
    return this.mutate(id, actor, version, key, { submit: wo, commit, packageId }, 'wo.submitted', (d) => {
      const { work, order } = workOrder(d, wo);
      const claim = work.snapshot.currentClaim;
      if (actor.kind !== 'BUILDER' || claim?.builderId !== actor.id || order.payment) throw new YardError('FORBIDDEN');
      open(order);
      beforeDeadline(d, order.milestone, now);
      leaseChange(() => work.submit(claim.id, commit, packageId, now));
      work.checking(packageId, now);
      order.actions.push({ kind: 'submit', claim: claim.id, commit, packageId, now });
      return { wo, state: 'CHECKING', packageId, simulated: true };
    });
  }
  async view(id: string, wo: string, actor: Operator) {
    const snapshot = await this.read(id, actor);
    const { work, order } = workOrder(data(snapshot.data), wo);
    return {
      ...work.snapshot,
      ...feedback(order),
      attempt: work.snapshot.attempt,
      hold: currentHold(order, work) ? { expiresAt: currentHold(order, work)?.expiresAt } : null,
      usage: order.usage ?? null,
      currentClaim: order.closed ? null : work.snapshot.currentClaim,
      state: status(order, work),
      payment: order.payment,
      projectVersion: snapshot.version,
      simulated: true,
    };
  }
  async room(id: string, actor: Operator, now?: number) {
    const snapshot = await this.read(id, actor),
      d = data(snapshot.data);
    return {
      id: snapshot.id,
      version: snapshot.version,
      handover: d.handover ?? null,
      costs: costDisclosure(d.blueprint, d.blueprint.costLines),
      ...(now === undefined ? {} : { clock: now }),
      previews: (d.previews ?? []).map((p) => ({ wo: p.wo, url: p.url, expiresAt: p.expiresAt })),
      mandate: d.mandate?.allowanceId
        ? {
            allowanceId: d.mandate.allowanceId,
            status: 'DRAFT',
            ...(d.mandate.amendmentRequired?.length ? { amendmentRequired: [...d.mandate.amendmentRequired] } : {}),
          }
        : null,
      changes: (d.changes ?? []).map((c) => ({
        id: c.id,
        status: c.status,
        milestones: c.changes.map((x) => x.milestoneId),
      })),
      signed: d.blueprint.status === 'FROZEN',
      milestoneCount: d.blueprint.milestones.length,
      summary: d.blueprint.summary,
      currency: d.blueprint.currency,
      simulated: true,
      orders: Object.keys(d.orders).map((wo) => {
        const { work, order } = workOrder(d, wo),
          milestone = terms(d, order.milestone)!;
        return {
          id: wo,
          name: milestone.name,
          budgetMinor: milestone.budgetMinor,
          trancheId: order.trancheId,
          state: status(order, work),
          ...feedback(order),
          attempt: work.snapshot.attempt,
          held: !!currentHold(order, work),
          // Signed acceptance tests are read-only: identity and bundle hash, never editable.
          tests: { ids: [...milestone.testIds], bundleHash: milestone.testBundleHash },
          payment: order.payment,
          submission: work.snapshot.submission,
          leasedUntil: work.snapshot.currentClaim?.leasedUntil ?? null,
          // C4 (#77): the final milestone releases only once the buyer confirms use, which Yard forwards to Stood.
          final: milestone.profileId === 'code.final@1',
          usage: order.usage
            ? { confirmedAt: order.usage.confirmedAt, status: order.usage.forwarded?.status ?? 'CONFIRMED' }
            : null,
        };
      }),
    };
  }
  // T-0189: work orders waiting on Stood: a hold for a claimed attempt, or a decision on a submitted package.
  async awaitingStood(after = '') {
    const projects = await this.events.list(after),
      page = projects.slice(0, 100);
    const items = page.flatMap((project) => {
      const d = data(project.data);
      return Object.keys(d.orders).flatMap((wo): AwaitingStood[] => {
        const { work, order } = workOrder(d, wo);
        const s = work.snapshot;
        if (order.payment || order.closed || !order.trancheId) return [];
        if (s.state === 'CHECKING' && s.submission?.packageId)
          return [
            {
              projectId: project.id,
              wo,
              trancheId: order.trancheId,
              waitingFor: 'DECISION',
              packageId: s.submission.packageId,
            },
          ];
        if (['CLAIMED', 'REWORK'].includes(s.state) && s.currentClaim && !currentHold(order, work))
          return [{ projectId: project.id, wo, trancheId: order.trancheId, waitingFor: 'HOLD' }];
        return [];
      });
    });
    return { items, nextCursor: projects.length > 100 ? (page.at(-1)?.id ?? null) : null };
  }
  // C4 (#77): final milestones whose use the buyer confirmed and Stood has not yet answered for, with what the signed
  // receipt binds: the allowance, the tranche and the commit Stood is judging.
  async pendingUsage(after = '') {
    const projects = await this.events.list(after),
      page = projects.slice(0, 100);
    const items = page.flatMap((project) => {
      const d = data(project.data);
      const allowanceId = d.mandate?.allowanceId;
      return Object.keys(d.orders).flatMap((wo) => {
        const { order } = workOrder(d, wo);
        const commit = order.submissionIntent?.status === 'CONFIRMED' ? order.submissionIntent.request.commit : null;
        if (!order.usage || order.usage.forwarded || order.payment || order.closed || !allowanceId || !commit)
          return [];
        return [
          {
            projectId: project.id,
            wo,
            allowanceId,
            trancheId: order.trancheId,
            commit,
            confirmedAt: order.usage.confirmedAt,
          },
        ];
      });
    });
    return { items, nextCursor: projects.length > 100 ? (page.at(-1)?.id ?? null) : null };
  }
  // Records Stood's answer to a forwarded usage receipt, once.
  usageForwarded(
    id: string,
    wo: string,
    version: number,
    answer: Readonly<{ at: number; status: 'ACCEPTED' | 'REFUSED'; reason: string | null }>,
  ) {
    return this.events.mutate(id, version, 'stood', `stood:usage:${wo}`, fingerprint({ wo, answer }), (raw) => {
      const d = data(raw);
      const { order } = workOrder(d, wo);
      if (!order.usage || order.usage.forwarded) throw new YardError('CONFLICT');
      order.usage = { ...order.usage, forwarded: { ...answer } };
      return { data: d, type: 'usage.forwarded', payload: { wo, status: answer.status, reason: answer.reason } };
    });
  }
  async pendingSubmissions(after = '') {
    const projects = await this.events.list(after),
      page = projects.slice(0, 100);
    const submissions = page.flatMap((project) =>
      Object.entries(data(project.data).orders).flatMap(([wo, order]) =>
        order.submissionIntent?.status === 'RESERVED'
          ? [{ projectId: project.id, wo, intent: structuredClone(order.submissionIntent) }]
          : [],
      ),
    );
    return { submissions, nextCursor: projects.length > 100 ? page.at(-1)!.id : null };
  }
  async prepareSubmission(
    id: string,
    wo: string,
    commit: string,
    actor: Operator,
    version: number,
    key: string,
    now: number,
  ): Promise<SubmissionIntent> {
    const current = await this.read(id, actor);
    const existing = workOrder(data(current.data), wo).order.submissionIntent;
    if (existing) {
      if (
        existing.key !== key ||
        existing.request.commit !== commit ||
        existing.expectedVersion !== version ||
        existing.actor.id !== actor.id ||
        existing.actor.root !== actor.root ||
        existing.actor.kind !== actor.kind
      )
        throw new YardError('CONFLICT');
      return structuredClone(existing);
    }
    const snapshot = await this.mutate(
      id,
      actor,
      version,
      `submission-reserve:${key}`,
      { wo, commit, actor, version, key },
      'submission.reserved',
      (d) => {
        const { work, order } = workOrder(d, wo);
        const claim = work.snapshot.currentClaim;
        if (actor.kind !== 'BUILDER' || claim?.builderId !== actor.id || order.payment || order.submissionIntent)
          throw new YardError('FORBIDDEN');
        open(order);
        beforeDeadline(d, order.milestone, now);
        leaseChange(() => work.submit(claim.id, commit, 'reservation-only', now)); // validate lease and commit before any HTTP
        order.submissionIntent = {
          key,
          actor: structuredClone(actor),
          claimId: claim.id,
          expectedVersion: version,
          reservedVersion: version + 1,
          request: {
            trancheId: order.trancheId,
            repository: d.blueprint.repository,
            baseCommit: d.blueprint.baseCommit,
            commit,
            key: `yard:${fingerprint({ id, wo, actor, claim: claim.id, commit, key })}`,
          },
          requestedAt: now,
          status: 'RESERVED',
          packageId: null,
          completedVersion: null,
        };
        return { wo, state: 'SUBMITTING', simulated: true };
      },
    );
    return structuredClone(workOrder(data(snapshot.data), wo).order.submissionIntent!);
  }
  completeSubmission(id: string, wo: string, intent: SubmissionIntent, packageId: string) {
    return this.atCurrent(id, (version) =>
      this.mutate(
        id,
        intent.actor,
        version,
        `submission-complete:${intent.key}`,
        {
          wo,
          requestKey: intent.request.key,
          claimId: intent.claimId,
          originalVersion: intent.expectedVersion,
          packageId,
        },
        'wo.submitted',
        (d) => {
          const { work, order } = workOrder(d, wo);
          if (
            !same(order.submissionIntent, intent) ||
            work.snapshot.currentClaim?.id !== intent.claimId ||
            order.payment
          )
            throw new YardError('CONFLICT');
          work.submit(intent.claimId, intent.request.commit, packageId, intent.requestedAt);
          work.checking(packageId, intent.requestedAt);
          order.actions.push({
            kind: 'submit',
            claim: intent.claimId,
            commit: intent.request.commit,
            packageId,
            now: intent.requestedAt,
          });
          order.submissionIntent = {
            ...intent,
            status: 'CONFIRMED',
            packageId,
            completedVersion: version + 1,
          };
          return { wo, state: 'CHECKING', packageId, simulated: true };
        },
      ),
    );
  }
  async submissionTerms(
    id: string,
    wo: string,
    actor: Operator,
    commit: string,
    version: number,
    key: string,
    now: number,
  ) {
    const snapshot = await this.read(id, actor);
    const d = data(snapshot.data);
    const { work, order } = workOrder(d, wo);
    if (actor.kind !== 'BUILDER' || work.snapshot.currentClaim?.builderId !== actor.id)
      throw new YardError('FORBIDDEN');
    if (work.snapshot.state !== 'BUILDING') {
      const packageId = work.snapshot.submission?.packageId;
      if (!packageId) throw new YardError('FORBIDDEN');
      try {
        return { receipt: await this.submit(id, wo, commit, packageId, actor, version, key, now) };
      } catch (error) {
        if (error instanceof YardError) throw error;
        throw new YardError('FORBIDDEN');
      }
    }
    if (snapshot.version !== version) throw new YardError('STALE_VERSION');
    return { trancheId: order.trancheId, repository: d.blueprint.repository, baseCommit: d.blueprint.baseCommit };
  }
  // Only an authenticated Stood integration calls this after matching provider-backed read proof.
  settlement(id: string, wo: string, proof: SettlementProof, version: number, now = Date.now()) {
    return this.events.mutate(id, version, 'stood', `stood:${proof.eventId}`, fingerprint({ wo, proof }), (raw) => {
      const d = data(raw);
      const { work, order } = workOrder(d, wo);
      const m = terms(d, order.milestone)!;
      const line = d.mandate?.lines?.find((l) => l.milestoneId === order.milestone);
      const feeMinor = line?.feeMinor ?? 0;
      if (
        work.snapshot.state !== 'CHECKING' ||
        order.payment ||
        order.closed ||
        proof.trancheId !== order.trancheId ||
        proof.packageId !== work.snapshot.submission?.packageId ||
        proof.effect !== 'CAPTURE' ||
        !proof.reference.trim() ||
        !proof.eventId.trim() ||
        proof.minor !== m.budgetMinor + feeMinor ||
        proof.currency !== d.blueprint.currency ||
        proof.simulated !== true
      )
        throw new YardError('INVALID');
      order.payment = structuredClone(proof);
      order.releasedAt = now;
      return {
        data: d,
        type: 'stood.released',
        // ADR-0027: the capture splits into the builder's line (paid out later) and Yard's fee.
        payload: {
          wo,
          state: 'PAID',
          reference: proof.reference,
          payment: structuredClone(proof),
          builderMinor: m.budgetMinor,
          feeMinor,
          simulated: true,
        },
      };
    });
  }
  // ADR-0027: the buyer opens a dispute on a paid milestone inside its review window, before any payout is reserved.
  // The money stays in this job's ledger until the dispute is closed by the owner.
  dispute(id: string, wo: string, actor: Operator, version: number, key: string, now: number, reason: string) {
    return this.events.mutate(id, version, actor.id, `dispute:${key}`, fingerprint({ wo, reason }), (raw) => {
      const d = data(raw);
      const { order } = workOrder(d, wo);
      if (actor.kind !== 'BUYER' || d.blueprint.buyerOperatorId !== actor.id || d.buyerRoot !== actor.root)
        throw new YardError('FORBIDDEN');
      const text = reason.trim();
      if (!text || text.length > 2000) throw new YardError('INVALID');
      const dueAt = payoutDueAt(d, order);
      if (!order.payment || order.payout || order.dispute || dueAt === null || now >= dueAt)
        throw new YardError('CONFLICT');
      order.dispute = { openedAt: now, reason: text };
      return { data: d, type: 'payout.disputed', payload: { wo, openedAt: now } };
    });
  }
  // ADR-0027: paid work orders whose payout is due now: released, past the review window (none for the final
  // milestone), not disputed and not yet reserved. Each comes with the builder who did the work.
  async payoutsDue(now: number) {
    const due: { projectId: string; wo: string; builderId: string; builderMinor: number; currency: string }[] = [];
    await this.eachProject((id, d) => {
      for (const [wo, order] of Object.entries(d.orders)) {
        const dueAt = payoutDueAt(d, order);
        const builderId = workOrder(d, wo).work.snapshot.currentClaim?.builderId;
        if (!order.payment || order.payout || dueAt === null || now < dueAt || !builderId) continue;
        const builderMinor = terms(d, order.milestone)!.budgetMinor;
        due.push({ projectId: id, wo, builderId, builderMinor, currency: d.blueprint.currency });
      }
    });
    return due;
  }
  // Written before PayPal is called. The batch id is fixed per work order and attempt, so a second reservation is the
  // same one.
  reservePayout(id: string, wo: string, version: number, payee: string, now: number) {
    return this.events.mutate(
      id,
      version,
      'yard-payouts',
      `payout:reserve:${wo}`,
      fingerprint({ wo, payee }),
      (raw) => {
        const d = data(raw);
        const { order } = workOrder(d, wo);
        const dueAt = payoutDueAt(d, order);
        if (!order.payment || order.payout || dueAt === null || now < dueAt) throw new YardError('CONFLICT');
        order.payout = {
          batchId: batchIdFor(id, wo, 1),
          attempt: 1,
          payee,
          builderMinor: terms(d, order.milestone)!.budgetMinor,
          currency: d.blueprint.currency,
          status: 'RESERVED',
          reservedAt: now,
        };
        return { data: d, type: 'payout.reserved', payload: { wo, batchId: order.payout.batchId, attempt: 1 } };
      },
    );
  }
  // PayPal's answer to the payout, then its item status as reconciliation reads it. Only moves PayPal's contract allows
  // are recorded, and only for the attempt (batch id) the caller read.
  payoutUpdate(
    id: string,
    wo: string,
    version: number,
    batchId: string,
    update: Readonly<{
      status: Exclude<PayoutStatus, 'RESERVED'>;
      payoutBatchId?: string;
      reference?: string;
      reason?: string;
    }>,
    now = Date.now(),
  ) {
    const key = `payout:${update.status}:${wo}:${batchId}`;
    return this.events.mutate(id, version, 'yard-payouts', key, fingerprint({ wo, batchId, update }), (raw) => {
      const d = data(raw);
      const { order } = workOrder(d, wo);
      const payout = order.payout;
      const from: Record<string, readonly PayoutStatus[]> = {
        SENT: ['RESERVED'],
        FAILED: ['RESERVED', 'SENT', 'UNCLAIMED'],
        PAID_OUT: ['SENT', 'UNCLAIMED'],
        UNCLAIMED: ['SENT'],
        RETURNED: ['SENT', 'UNCLAIMED', 'PAID_OUT'],
        REVIEW: ['RESERVED', 'SENT', 'UNCLAIMED'],
      };
      if (!payout || payout.batchId !== batchId || !from[update.status]?.includes(payout.status))
        throw new YardError('CONFLICT');
      if (update.status === 'SENT' && !update.payoutBatchId) throw new YardError('INVALID');
      payout.status = update.status;
      if (update.payoutBatchId) payout.payoutBatchId = update.payoutBatchId;
      if (update.reference) payout.reference = update.reference;
      if (update.reason) payout.reason = update.reason.slice(0, 200);
      if (update.status === 'PAID_OUT') payout.settledAt = now;
      return {
        data: d,
        type: `payout.${update.status.toLowerCase()}`,
        payload: { wo, batchId, status: update.status, ...(update.reason ? { reason: payout.reason } : {}) },
      };
    });
  }
  // Third audit (2026-10-11): the owner's actions on a job's money, so nothing is ever a dead end. Each is checked
  // against the work order's state and recorded with the owner's note.
  payoutAction(id: string, wo: string, version: number, key: string, now: number, action: PayoutAction) {
    return this.events.mutate(id, version, 'yard-owner', `owner:${key}`, fingerprint({ wo, action }), (raw) => {
      const d = data(raw);
      const { order } = workOrder(d, wo);
      const note = action.note.trim();
      if (!note || note.length > 2000) throw new YardError('INVALID');
      const payout = order.payout;
      switch (action.type) {
        case 'RESOLVE_DISPUTE':
          if (!order.dispute || order.dispute.resolved || payout) throw new YardError('CONFLICT');
          order.dispute.resolved = { outcome: action.outcome, at: now };
          if (action.outcome === 'REFUND_BUYER') order.refund = { status: 'DUE', at: now };
          break;
        case 'RETRY_PAYOUT':
          if (!payout || !['FAILED', 'RETURNED'].includes(payout.status) || order.refund)
            throw new YardError('CONFLICT');
          if (!payee(action.payee)) throw new YardError('INVALID');
          order.payout = {
            ...payout,
            history: [
              ...(payout.history ?? []),
              {
                batchId: payout.batchId,
                status: payout.status,
                ...(payout.reference ? { reference: payout.reference } : {}),
              },
            ],
            batchId: batchIdFor(id, wo, payout.attempt + 1),
            attempt: payout.attempt + 1,
            payee: action.payee,
            status: 'RESERVED',
            reservedAt: now,
          };
          delete order.payout.payoutBatchId;
          delete order.payout.reference;
          delete order.payout.reason;
          break;
        case 'REFUND_BUYER':
          if (!order.payment || order.refund || (payout && !['FAILED', 'RETURNED'].includes(payout.status)))
            throw new YardError('CONFLICT');
          order.refund = { status: 'DUE', at: now };
          break;
        case 'REFUNDED':
          if (order.refund?.status !== 'DUE' || !action.reference.trim()) throw new YardError('CONFLICT');
          order.refund = { status: 'REFUNDED', at: now, reference: action.reference.trim().slice(0, 200) };
          break;
        case 'SETTLE_REVIEW':
          if (payout?.status !== 'REVIEW' || !action.reference.trim()) throw new YardError('CONFLICT');
          if (action.outcome === 'PAID_OUT') {
            if (!/^[A-Z0-9]{8,40}$/.test(action.payoutBatchId ?? '')) throw new YardError('INVALID');
            payout.payoutBatchId = action.payoutBatchId as string;
          }
          payout.status = action.outcome === 'PAID_OUT' ? 'PAID_OUT' : 'FAILED';
          payout.reference = action.reference.trim().slice(0, 200);
          if (payout.status === 'PAID_OUT') payout.settledAt = now;
          break;
      }
      return { data: d, type: `owner.${action.type.toLowerCase()}`, payload: { wo, action: action.type, note } };
    });
  }
  // Payouts the worker still watches: in flight (reserved, sent, unclaimed), and paid out within the last 180 days,
  // because PayPal can still report those refunded or reversed.
  async payoutsOpen(now = Date.now()) {
    const open: { projectId: string; wo: string; payout: Payout }[] = [];
    await this.eachProject((id, d) => {
      for (const [wo, order] of Object.entries(d.orders)) {
        const p = order.payout;
        if (!p) continue;
        const watched =
          ['RESERVED', 'SENT', 'UNCLAIMED'].includes(p.status) ||
          (p.status === 'PAID_OUT' && p.payoutBatchId && now - (p.settledAt ?? now) < 180 * 86_400_000);
        if (watched) open.push({ projectId: id, wo, payout: structuredClone(p) });
      }
    });
    return open;
  }
  // Third audit (2026-10-11): every work order whose money needs the owner: an open dispute, a payout to reconcile,
  // failed, returned or unclaimed, or a refund still owed to the buyer.
  async payoutAttention() {
    const items: {
      projectId: string;
      wo: string;
      state: string;
      builderMinor: number;
      currency: string;
      reason?: string;
    }[] = [];
    await this.eachProject((id, d) => {
      for (const [wo, order] of Object.entries(d.orders)) {
        const state =
          order.refund?.status === 'DUE'
            ? 'REFUND_DUE'
            : order.dispute && !order.dispute.resolved
              ? 'DISPUTED'
              : order.payout && ['REVIEW', 'FAILED', 'RETURNED', 'UNCLAIMED'].includes(order.payout.status)
                ? order.payout.status
                : null;
        if (!state) continue;
        const reason = order.payout?.reason ?? order.dispute?.reason;
        items.push({
          projectId: id,
          wo,
          state,
          builderMinor: terms(d, order.milestone)!.budgetMinor,
          currency: d.blueprint.currency,
          ...(reason ? { reason } : {}),
        });
      }
    });
    return items;
  }
  // Every project once, a hundred at a time (a page of 101 means there is another page).
  private async eachProject(visit: (id: string, d: Data) => void) {
    let after = '';
    do {
      const projects = await this.events.list(after);
      const page = projects.slice(0, 100);
      for (const p of page) visit(p.id, data(p.data));
      after = projects.length > 100 ? (page.at(-1)?.id ?? '') : '';
    } while (after);
  }
  // ADR-0027: the job's ledger, one line per work order, never a general balance. Buyer only.
  async ledger(id: string, actor: Operator) {
    const snapshot = await this.read(id, actor);
    const d = data(snapshot.data);
    if (actor.kind !== 'BUYER' || d.blueprint.buyerOperatorId !== actor.id) throw new YardError('FORBIDDEN');
    return Object.entries(d.orders).map(([wo, order]) => {
      const line = d.mandate?.lines?.find((l) => l.milestoneId === order.milestone);
      const builderMinor = terms(d, order.milestone)!.budgetMinor;
      const dueAt = payoutDueAt(d, order);
      const state = order.refund
        ? order.refund.status === 'DUE'
          ? 'REFUND_DUE'
          : 'REFUNDED'
        : order.payout
          ? order.payout.status
          : order.dispute && !order.dispute.resolved
            ? 'DISPUTED'
            : order.payment
              ? 'HELD_BACK'
              : order.closed
                ? 'VOIDED'
                : 'AUTHORIZED';
      return {
        wo,
        milestoneId: order.milestone,
        currency: d.blueprint.currency,
        builderMinor,
        feeMinor: line?.feeMinor ?? 0,
        state,
        capturedMinor: order.payment?.minor ?? 0,
        payoutDueAt: order.payment ? dueAt : null,
        disputedAt: order.dispute?.openedAt ?? null,
        payoutReference: order.payout?.reference ?? order.payout?.payoutBatchId ?? null,
        payoutAttempts: order.payout?.attempt ?? 0,
        refundReference: order.refund?.reference ?? null,
        simulated: true as const,
      };
    });
  }
  // Only an authenticated Stood integration calls this after a matching read shows the tranche HELD.
  holdConfirmed(id: string, wo: string, proof: HoldProof, version: number) {
    return this.events.mutate(id, version, 'stood', `stood:${proof.eventId}`, fingerprint({ wo, proof }), (raw) => {
      const d = data(raw);
      const { work, order } = workOrder(d, wo);
      if (
        order.payment ||
        order.closed ||
        !work.snapshot.currentClaim ||
        !['CLAIMED', 'REWORK'].includes(work.snapshot.state) ||
        currentHold(order, work) ||
        proof.trancheId !== order.trancheId ||
        proof.effect !== 'HOLD' ||
        !Number.isSafeInteger(proof.expiresAt) ||
        proof.expiresAt <= work.snapshot.lastAt ||
        typeof proof.eventId !== 'string' ||
        !proof.eventId.trim() ||
        proof.simulated !== true
      )
        throw new YardError('INVALID');
      order.holds = [
        ...(order.holds ?? []),
        { attempt: work.snapshot.attempt, expiresAt: proof.expiresAt, eventId: proof.eventId },
      ];
      return {
        data: d,
        type: 'stood.held',
        payload: { wo, attempt: work.snapshot.attempt, expiresAt: proof.expiresAt, simulated: true },
      };
    });
  }
  // Only an authenticated Stood integration calls this after a matching provider-backed VOID read.
  // A refusal is build feedback: it never confirms or invents a payment.
  refusal(id: string, wo: string, proof: RefusalProof, version: number) {
    return this.events.mutate(id, version, 'stood', `stood:${proof.eventId}`, fingerprint({ wo, proof }), (raw) => {
      const d = data(raw);
      const { work, order } = workOrder(d, wo);
      const submission = work.snapshot.submission;
      if (
        work.snapshot.state !== 'CHECKING' ||
        order.payment ||
        order.closed ||
        !submission ||
        proof.trancheId !== order.trancheId ||
        proof.packageId !== submission.packageId ||
        proof.effect !== 'VOID' ||
        typeof proof.reference !== 'string' ||
        !proof.reference.trim() ||
        proof.reference.length > 200 ||
        typeof proof.eventId !== 'string' ||
        !proof.eventId.trim() ||
        !Number.isSafeInteger(proof.resubmissionsLeft) ||
        proof.resubmissionsLeft < 0 ||
        proof.resubmissionsLeft > 5 ||
        proof.simulated !== true
      )
        throw new YardError('INVALID');
      const items = punchList(proof.punchList);
      const final = proof.resubmissionsLeft === 0;
      const at = work.snapshot.lastAt;
      order.refusals = [
        ...(order.refusals ?? []),
        {
          eventId: proof.eventId,
          packageId: proof.packageId,
          reference: proof.reference,
          punchList: items,
          attempt: work.snapshot.attempt,
          final,
        },
      ];
      if (order.submissionIntent) {
        order.pastSubmissions = [...(order.pastSubmissions ?? []), order.submissionIntent];
        delete order.submissionIntent;
      }
      if (final) order.closed = 'REFUSED';
      else {
        work.rework(proof.packageId, at);
        order.actions.push({ kind: 'rework', packageId: proof.packageId, now: at });
      }
      return {
        data: d,
        type: 'stood.refused',
        payload: {
          wo,
          state: final ? 'REFUSED' : 'REWORK',
          reference: proof.reference,
          punchList: items,
          attempt: work.snapshot.attempt,
          simulated: true,
        },
      };
    });
  }
}
