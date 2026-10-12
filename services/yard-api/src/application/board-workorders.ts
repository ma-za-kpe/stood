import { Blueprint, type FreezeProof, WorkOrder } from '@stood/yard-domain';
import { YardError, type YardEvents } from '../ports/events.js';
import type { BoardContext } from './board-context.js';
import {
  beforeDeadline,
  currentHold,
  data,
  fingerprint,
  leaseChange,
  type Operator,
  open,
  status,
  terms,
  workOrder,
} from './board-state.js';

export class BoardWorkOrders {
  constructor(private readonly context: BoardContext) {}
  freeze(id: string, proof: FreezeProof, actor: Operator, version: number, key: string) {
    return this.context.mutate(id, actor, version, key, { freeze: proof }, 'blueprint.approved', (d) => {
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
    return this.context.mutate(
      id,
      actor,
      version,
      key,
      { post: milestone, trancheId: requested ?? null },
      'wo.posted',
      (d) => {
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
      },
    );
  }
  async claim(id: string, wo: string, actor: Operator, version: number, key: string, now: number) {
    const current = await this.context.events.load(id);
    const existing = Object.hasOwn(data(current.data).orders, wo)
      ? workOrder(data(current.data), wo).work.snapshot.currentClaim
      : null;
    // A replay of this builder's own claim is not a new claim; anything else counts against the cap.
    if (
      existing?.builderId !== actor.id &&
      (await this.context.activeClaims(actor.root, now, { id, wo })) >= this.context.limits.maxActiveClaims
    )
      throw new YardError('CONFLICT');
    return this.context.mutate(id, actor, version, key, { claim: wo }, 'wo.claimed', (d) => {
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
    return this.context.mutate(id, actor, version, key, { build: wo }, 'wo.building', (d) => {
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
    return this.context.mutate(id, actor, version, key, { expire: wo }, 'wo.lease_expired', (d) => {
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
    return this.context.mutate(id, actor, version, key, { release: wo }, 'wo.released_claim', (d) => {
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
    return this.context.mutate(id, actor, version, key, { repost: wo }, 'wo.reposted', (d) => {
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
    return this.context.mutate(id, actor, version, key, { submit: wo, commit, packageId }, 'wo.submitted', (d) => {
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
}
