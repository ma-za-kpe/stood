import { BUYER_HANDOVER_ITEMS } from '@stood/yard-contracts';
import { WORK_ORDER_TRANSITIONS } from '@stood/yard-domain';
export type MoneyProof = Readonly<{
  trancheId: string;
  packageId: string;
  reference: string;
  effect: 'CAPTURE';
  minor: number;
  currency: string;
  simulated: true;
}>;
export type PunchItem = Readonly<{ field: string; reason: string }>;
export type RefusalView = Readonly<{ packageId: string; reference: string; attempt: number; final: boolean }>;
export type OrderView = Readonly<{
  id: string;
  name: string;
  state: string;
  budgetMinor: number;
  trancheId: string;
  payment: MoneyProof | null;
  submission: Readonly<{ packageId: string; commit: string }> | null;
  leasedUntil: number | null;
  attempt?: number;
  held?: boolean;
  tests?: Readonly<{ ids: readonly string[]; bundleHash: string }>;
  punchList?: readonly PunchItem[] | null;
  refusals?: readonly RefusalView[];
  // C4 (#77): the final milestone, and the buyer's usage confirmation as Stood has answered it.
  final?: boolean;
  usage?: Readonly<{ confirmedAt: number; status: 'CONFIRMED' | 'ACCEPTED' | 'REFUSED' }> | null;
}>;
export type Handover = Readonly<{ status: 'CLOSED'; closedAt: number; confirmed: readonly string[] }>;
export type ProjectRoom = Readonly<{
  id: string;
  version: number;
  handover?: Handover | null;
  signed?: boolean;
  milestoneCount?: number;
  clock?: number;
  summary: string;
  currency: string;
  simulated: true;
  orders: readonly OrderView[];
}>;
export type RoomEvent = Readonly<{ seq: number; type: string; actor: string; payload: unknown }>;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
// A punch list names failed checks. It is build feedback, never money.
function punchList(v: unknown): readonly PunchItem[] | null {
  if (
    !Array.isArray(v) ||
    v.length < 1 ||
    v.length > 20 ||
    v.some(
      (i) =>
        !object(i) ||
        typeof i.field !== 'string' ||
        !/^[a-z][a-z0-9_]{0,63}$/.test(i.field) ||
        typeof i.reason !== 'string' ||
        !i.reason.trim() ||
        i.reason.length > 300,
    )
  )
    return null;
  return v.map((i) => ({ field: String(i.field), reason: String(i.reason) }));
}
const transitions: Readonly<Record<string, Readonly<{ from: readonly string[]; to: string }>>> = {
  'wo.claimed': { from: WORK_ORDER_TRANSITIONS.CLAIMED, to: 'CLAIMED' },
  'wo.building': { from: WORK_ORDER_TRANSITIONS.BUILDING, to: 'BUILDING' },
  'submission.reserved': { from: WORK_ORDER_TRANSITIONS.SUBMITTED, to: 'SUBMITTING' },
  'wo.submitted': { from: ['BUILDING', 'SUBMITTING'], to: 'CHECKING' },
};
export function applyEvent(room: ProjectRoom, e: RoomEvent): ProjectRoom | 'GAP' {
  if (!Number.isSafeInteger(e.seq) || e.seq < 1) return 'GAP';
  if (e.seq <= room.version) return room;
  // Hidden or metadata-only events keep their position and never change what is shown.
  if (['yard.private', 'secret.added', 'secret.revoked'].includes(e.type))
    return e.seq === room.version + 1 ? { ...room, version: e.seq } : 'GAP';
  if (e.seq !== room.version + 1 || !object(e.payload) || typeof e.payload.wo !== 'string') return 'GAP';
  const p = e.payload,
    order = room.orders.find((o) => o.id === p.wo);
  if (!order) return 'GAP';
  let next: OrderView;
  if (e.type === 'stood.released') {
    const proof = p.payment;
    if (
      e.actor !== 'stood' ||
      order.state !== 'CHECKING' ||
      p.state !== 'PAID' ||
      !object(proof) ||
      proof.effect !== 'CAPTURE' ||
      proof.trancheId !== order.trancheId ||
      proof.packageId !== order.submission?.packageId ||
      proof.minor !== order.budgetMinor ||
      proof.currency !== room.currency ||
      proof.simulated !== true ||
      typeof proof.reference !== 'string' ||
      !proof.reference.trim()
    )
      return 'GAP';
    next = { ...order, state: 'PAID', payment: proof as MoneyProof, punchList: null };
  } else if (e.type === 'stood.refused') {
    const items = punchList(p.punchList);
    const attempt = order.attempt ?? 1;
    if (
      e.actor !== 'stood' ||
      order.state !== 'CHECKING' ||
      !['REWORK', 'REFUSED'].includes(String(p.state)) ||
      !items ||
      p.attempt !== (p.state === 'REWORK' ? attempt + 1 : attempt)
    )
      return 'GAP';
    next = { ...order, state: String(p.state), punchList: items, submission: null, attempt: Number(p.attempt) };
  } else {
    const rule = transitions[e.type];
    if (!rule || !rule.from.includes(order.state) || (p.state !== undefined && p.state !== rule.to)) return 'GAP';
    // A submission needs its bound package/commit; reload its complete snapshot.
    if (e.type === 'wo.submitted') return 'GAP';
    next = {
      ...order,
      state: rule.to,
      leasedUntil: typeof p.leasedUntil === 'number' ? p.leasedUntil : order.leasedUntil,
    };
  }
  return { ...room, version: e.seq, orders: room.orders.map((o) => (o.id === order.id ? next : o)) };
}
const identifier = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(v);
const states = [
  'POSTED',
  'CLAIMED',
  'BUILDING',
  'SUBMITTING',
  'CHECKING',
  'REWORK',
  'REFUSED',
  'PUNCH_LIST',
  'ABANDONED',
  'LEASE_EXPIRED',
  'PAID',
];
export function roomChecked(value: unknown): ProjectRoom {
  if (
    !object(value) ||
    value.simulated !== true ||
    !identifier(value.id) ||
    !Number.isSafeInteger(value.version) ||
    Number(value.version) < 0 ||
    typeof value.summary !== 'string' ||
    !['USD', 'GBP', 'EUR'].includes(String(value.currency)) ||
    !Array.isArray(value.orders)
  )
    throw new Error('Invalid project snapshot');
  if (value.signed !== undefined && typeof value.signed !== 'boolean') throw new Error('Invalid signing state');
  if (value.clock !== undefined && (!Number.isSafeInteger(value.clock) || Number(value.clock) < 0))
    throw new Error('Invalid server clock');
  if (
    value.milestoneCount !== undefined &&
    (!Number.isSafeInteger(value.milestoneCount) || Number(value.milestoneCount) < value.orders.length)
  )
    throw new Error('Invalid milestone count');
  const h = value.handover;
  if (
    h !== undefined &&
    h !== null &&
    (!object(h) ||
      h.status !== 'CLOSED' ||
      !Number.isSafeInteger(h.closedAt) ||
      Number(h.closedAt) < 0 ||
      !Array.isArray(h.confirmed) ||
      h.confirmed.length !== BUYER_HANDOVER_ITEMS.length ||
      h.confirmed.some((id) => !BUYER_HANDOVER_ITEMS.includes(String(id))))
  )
    throw new Error('Invalid handover');
  const seen = new Set<string>();
  for (const o of value.orders) {
    if (
      !object(o) ||
      !identifier(o.id) ||
      typeof o.name !== 'string' ||
      typeof o.state !== 'string' ||
      !states.includes(o.state) ||
      !Number.isSafeInteger(o.budgetMinor) ||
      Number(o.budgetMinor) <= 0 ||
      !identifier(o.trancheId)
    )
      throw new Error('Invalid work order');
    if (seen.has(o.id)) throw new Error('Duplicate work order');
    seen.add(o.id);
    if (
      o.submission !== null &&
      (!object(o.submission) ||
        !identifier(o.submission.packageId) ||
        typeof o.submission.commit !== 'string' ||
        !/^[a-f0-9]{40}$/.test(o.submission.commit))
    )
      throw new Error('Invalid submission');
    if (o.leasedUntil !== null && (!Number.isSafeInteger(o.leasedUntil) || Number(o.leasedUntil) < 0))
      throw new Error('Invalid lease');
    if (o.attempt !== undefined && (!Number.isSafeInteger(o.attempt) || Number(o.attempt) < 1))
      throw new Error('Invalid attempt');
    if (o.final !== undefined && typeof o.final !== 'boolean') throw new Error('Invalid final flag');
    if (
      o.usage !== undefined &&
      o.usage !== null &&
      (!object(o.usage) ||
        !Number.isSafeInteger(o.usage.confirmedAt) ||
        !['CONFIRMED', 'ACCEPTED', 'REFUSED'].includes(String(o.usage.status)))
    )
      throw new Error('Invalid usage');
    if (o.punchList !== undefined && o.punchList !== null && !punchList(o.punchList))
      throw new Error('Invalid punch list');
    const refusals = o.refusals === undefined ? [] : o.refusals;
    if (
      !Array.isArray(refusals) ||
      refusals.some(
        (r) =>
          !object(r) ||
          !identifier(r.packageId) ||
          typeof r.reference !== 'string' ||
          !r.reference.trim() ||
          !Number.isSafeInteger(r.attempt) ||
          typeof r.final !== 'boolean',
      )
    )
      throw new Error('Invalid refusal history');
    if (
      ['REWORK', 'REFUSED'].includes(o.state) &&
      (o.payment !== null ||
        o.submission !== null ||
        !punchList(o.punchList) ||
        (refusals.at(-1) as { final?: boolean } | undefined)?.final !== (o.state === 'REFUSED'))
    )
      throw new Error('Invalid refusal state');
    if (o.state === 'PAID') {
      const proof = o.payment;
      if (
        !object(proof) ||
        proof.effect !== 'CAPTURE' ||
        typeof proof.reference !== 'string' ||
        !proof.reference.trim() ||
        proof.minor !== o.budgetMinor ||
        proof.currency !== value.currency ||
        proof.trancheId !== o.trancheId ||
        proof.simulated !== true ||
        !object(o.submission) ||
        proof.packageId !== o.submission.packageId
      )
        throw new Error('Missing Stood proof');
    } else if (o.payment !== null || o.state === 'RELEASED') throw new Error('Unknown money state');
  }
  return structuredClone(value) as ProjectRoom;
}
