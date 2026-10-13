import { createHash } from 'node:crypto';
import { Blueprint, type BlueprintInput, costDisclosure, type FreezeProof, WorkOrder } from '@stood/yard-domain';
import { YardError, type YardEvent, type YardEvents, type YardSnapshot } from '../ports/events.js';
import type { AmendmentIntent } from './board-amendment-types.js';
import type { MandateRequest } from './mandate-request.js';

export type { MandateRequest } from './mandate-request.js';
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
export type Refusal = Readonly<{
  eventId: string;
  packageId: string;
  reference: string;
  punchList: readonly PunchItem[];
  attempt: number;
  final: boolean;
}>;
export type Action =
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
export type Order = {
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
  termsVersion?: number;
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
export const payee = (v: string) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[A-Za-z]{2,24}$/.test(v) || /^[A-Z0-9]{13}$/.test(v);
export const batchIdFor = (id: string, wo: string, attempt: number) =>
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
export type ChangeOrder = {
  id: string;
  status: 'PROPOSED' | 'APPROVED';
  changes: MilestoneChange[];
  proposedAt: number;
};
export type Handover = { status: 'CLOSED'; closedAt: number; confirmed: readonly string[] };
export type Data = {
  blueprint: Blueprint['snapshot'];
  buyerRoot: string;
  orders: Record<string, Order>;
  handover?: Handover;
  mandate?: MandateIntent & { amendmentRequired?: string[] };
  changes?: ChangeOrder[];
  amendments?: AmendmentIntent[];
  previews?: { wo: string; serviceId: string; url: string; expiresAt: number }[];
  // Fifth audit (2026-10-11): a preview deploy reserved before Render is called, so a crash leaves a trace to repair.
  previewIntents?: { wo: string; deployId: string; name: string; at: number }[];
};
// ADR-0027: when a paid work order may be paid out: at release for the final milestone, 48 hours later otherwise.
export function payoutDueAt(d: Data, order: Order): number | null {
  if (!order.payment || order.releasedAt === undefined || order.refund) return null;
  // A dispute holds the payout until the owner decides it for the builder; then it is due at once.
  if (order.dispute) return order.dispute.resolved?.outcome === 'PAY_BUILDER' ? order.dispute.resolved.at : null;
  const final = terms(d, order.milestone)?.profileId === 'code.final@1';
  return final ? order.releasedAt : order.releasedAt + HOLDBACK_MS;
}
// Effective milestone terms: the immutable signed milestone with approved change orders applied in order.
export function terms(d: Data, milestoneId: string) {
  const base = d.blueprint.milestones.find((m) => m.id === milestoneId);
  if (!base) return undefined;
  let effective = { ...base };
  for (const order of d.changes ?? [])
    if (order.status === 'APPROVED')
      for (const c of order.changes)
        if (c.milestoneId === milestoneId)
          effective = { ...effective, name: c.name, budgetMinor: c.budgetMinor, deadline: c.deadline };
  for (const amendment of d.amendments ?? [])
    if (amendment.status === 'SIGNED')
      for (const change of amendment.changes)
        if (change.milestoneId === milestoneId) {
          const { milestoneId: _id, ...evidence } = change;
          effective = { ...effective, ...evidence };
        }
  return effective;
}
export const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// The public Board identity of a posted work order (no buyer data).
export const offerId = (projectId: string, workOrderId: string) => fingerprint({ projectId, workOrderId });
export function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, v]) => [key, canonical(v)]),
    );
  return value;
}
export const same = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
export function data(value: unknown): Data {
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
export function leaseChange(change: () => void): void {
  try {
    change();
  } catch (error) {
    throw new YardError(error instanceof RangeError ? 'INVALID' : 'CONFLICT');
  }
}
export function workOrder(d: Data, id: string): { order: Order; work: WorkOrder } {
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
export function beforeDeadline(d: Data, milestoneId: string, now: number): void {
  if (!Number.isSafeInteger(now) || now < d.blueprint.createdAt) throw new YardError('INVALID');
  const milestone = terms(d, milestoneId);
  if (!milestone) throw new YardError('INVALID');
  if (now >= milestone.deadline) throw new YardError('CONFLICT');
}
export function open(order: Order): void {
  if (order.payment || order.closed) throw new YardError('CONFLICT');
}
export const field = /^[a-z][a-z0-9_]{0,63}$/;
export function punchList(value: unknown): readonly PunchItem[] {
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
export function currentHold(order: Order, work: WorkOrder) {
  return order.holds?.find((h) => h.attempt === work.snapshot.attempt) ?? null;
}
export function status(order: Order, work: WorkOrder): string {
  if (order.payment) return 'PAID';
  if (order.closed) return order.closed;
  if (order.submissionIntent?.status === 'RESERVED') return 'SUBMITTING';
  return work.snapshot.state;
}
export function feedback(order: Order) {
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
export const BUILDER_EVENTS = new Set([
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
