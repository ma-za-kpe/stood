import type { YardEvents } from '../ports/events.js';
import { YardError } from '../ports/events.js';
import {
  batchIdFor,
  type Data,
  data,
  fingerprint,
  open,
  type Payout,
  type PayoutAction,
  type PayoutStatus,
  payee,
  payoutDueAt,
  same,
  status,
  terms,
  workOrder,
} from './board-state.js';

export class BoardPayouts {
  constructor(private readonly events: YardEvents) {}
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
}
