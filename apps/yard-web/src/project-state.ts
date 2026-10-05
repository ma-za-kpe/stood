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
export type OrderView = Readonly<{
  id: string;
  name: string;
  state: string;
  budgetMinor: number;
  trancheId: string;
  payment: MoneyProof | null;
  submission: Readonly<{ packageId: string; commit: string }> | null;
  leasedUntil: number | null;
}>;
export type ProjectRoom = Readonly<{
  id: string;
  version: number;
  summary: string;
  currency: string;
  simulated: true;
  orders: readonly OrderView[];
}>;
export type RoomEvent = Readonly<{ seq: number; type: string; actor: string; payload: unknown }>;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const transitions: Readonly<Record<string, Readonly<{ from: readonly string[]; to: string }>>> = {
  'wo.claimed': { from: WORK_ORDER_TRANSITIONS.CLAIMED, to: 'CLAIMED' },
  'wo.building': { from: WORK_ORDER_TRANSITIONS.BUILDING, to: 'BUILDING' },
  'submission.reserved': { from: WORK_ORDER_TRANSITIONS.SUBMITTED, to: 'SUBMITTING' },
  'wo.submitted': { from: ['BUILDING', 'SUBMITTING'], to: 'CHECKING' },
};
export function applyEvent(room: ProjectRoom, e: RoomEvent): ProjectRoom | 'GAP' {
  if (!Number.isSafeInteger(e.seq) || e.seq < 1) return 'GAP';
  if (e.seq <= room.version) return room;
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
    next = { ...order, state: 'PAID', payment: proof as MoneyProof };
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
    } else if (o.payment !== null || ['REFUSED', 'RELEASED'].includes(o.state)) throw new Error('Unknown money state');
  }
  return structuredClone(value) as ProjectRoom;
}
