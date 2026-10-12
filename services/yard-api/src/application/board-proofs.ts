import { Blueprint, type FreezeProof, WorkOrder } from '@stood/yard-domain';
import { YardError, type YardEvents } from '../ports/events.js';
import type { BoardContext } from './board-context.js';
import {
  currentHold,
  data,
  feedback,
  fingerprint,
  type HoldProof,
  punchList,
  type RefusalProof,
  type SettlementProof,
  terms,
  workOrder,
} from './board-state.js';

export class BoardProofs {
  constructor(private readonly events: YardEvents) {}
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
