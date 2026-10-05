import { createHash } from 'node:crypto';
import { Blueprint, type BlueprintInput, type FreezeProof, WorkOrder } from '@stood/yard-domain';
import { YardError, type YardEvents, type YardSnapshot } from '../ports/events.js';
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
type Action =
  | { kind: 'claim'; id: string; actor: Operator; now: number }
  | { kind: 'build'; claim: string; now: number }
  | { kind: 'submit'; claim: string; commit: string; packageId: string; now: number }
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
};
type Data = { blueprint: Blueprint['snapshot']; buyerRoot: string; orders: Record<string, Order> };
const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
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
export class Board {
  constructor(readonly events: YardEvents) {}
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
  async discover() {
    return (await this.discoverPage()).orders;
  }
  async discoverPage(after = '') {
    if (after && !/^[A-Za-z0-9_-]{1,100}$/.test(after)) throw new YardError('INVALID');
    const projects = await this.events.list(after);
    const page = projects.slice(0, 100);
    const orders = page.flatMap((s) => {
      const d = data(s.data);
      return Object.keys(d.orders).flatMap((id) => {
        const { work, order } = workOrder(d, id);
        const milestone = d.blueprint.milestones.find((m) => m.id === order.milestone)!;
        if (order.payment || work.snapshot.state !== 'POSTED') return [];
        return [
          {
            projectId: s.id,
            id: fingerprint({ projectId: s.id, workOrderId: id }),
            workOrderId: id,
            name: milestone.name,
            priceMinor: milestone.budgetMinor,
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
  post(id: string, milestone: string, trancheId: string, actor: Operator, version: number, key: string, now: number) {
    return this.mutate(id, actor, version, key, { post: milestone, trancheId }, 'wo.posted', (d) => {
      if (actor.kind !== 'BUYER' || d.blueprint.buyerOperatorId !== actor.id) throw new YardError('FORBIDDEN');
      if (
        d.blueprint.status !== 'FROZEN' ||
        !d.blueprint.milestones.some((m) => m.id === milestone) ||
        Object.hasOwn(d.orders, milestone) ||
        !/^[A-Za-z0-9_-]{1,200}$/.test(trancheId)
      )
        throw new YardError('INVALID');
      const work = new WorkOrder(milestone, actor.root, now);
      d.orders[milestone] = { id: work.snapshot.id, milestone, trancheId, postedAt: now, actions: [], payment: null };
      return { wo: milestone, state: 'POSTED', simulated: true };
    });
  }
  claim(id: string, wo: string, actor: Operator, version: number, key: string, now: number) {
    return this.mutate(id, actor, version, key, { claim: wo }, 'wo.claimed', (d) => {
      if (actor.kind !== 'BUILDER') throw new YardError('FORBIDDEN');
      const { work, order } = workOrder(d, wo);
      if (order.payment) throw new YardError('CONFLICT');
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
      work.build(claim.id, now);
      order.actions.push({ kind: 'build', claim: claim.id, now });
      return { wo, state: 'BUILDING', simulated: true };
    });
  }
  expireLease(id: string, wo: string, actor: Operator, version: number, key: string, now: number) {
    return this.mutate(id, actor, version, key, { expire: wo }, 'wo.lease_expired', (d) => {
      if (actor.kind !== 'BUYER' || d.blueprint.buyerOperatorId !== actor.id) throw new YardError('FORBIDDEN');
      const { work, order } = workOrder(d, wo);
      if (order.payment || order.submissionIntent?.status === 'RESERVED') throw new YardError('CONFLICT');
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
      if (order.payment || order.submissionIntent?.status === 'RESERVED') throw new YardError('CONFLICT');
      leaseChange(() => work.release(claim.id, now));
      order.actions.push({ kind: 'release', claim: claim.id, now });
      return { wo, state: 'ABANDONED', simulated: true };
    });
  }
  repost(id: string, wo: string, actor: Operator, version: number, key: string, now: number) {
    return this.mutate(id, actor, version, key, { repost: wo }, 'wo.reposted', (d) => {
      if (actor.kind !== 'BUYER' || d.blueprint.buyerOperatorId !== actor.id) throw new YardError('FORBIDDEN');
      const { work, order } = workOrder(d, wo);
      if (order.payment || order.submissionIntent?.status === 'RESERVED') throw new YardError('CONFLICT');
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
      work.submit(claim.id, commit, packageId, now);
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
      state: order.payment
        ? 'PAID'
        : order.submissionIntent?.status === 'RESERVED'
          ? 'SUBMITTING'
          : work.snapshot.state,
      payment: order.payment,
      projectVersion: snapshot.version,
      simulated: true,
    };
  }
  async room(id: string, actor: Operator) {
    const snapshot = await this.read(id, actor),
      d = data(snapshot.data);
    return {
      id: snapshot.id,
      version: snapshot.version,
      summary: d.blueprint.summary,
      currency: d.blueprint.currency,
      simulated: true,
      orders: Object.keys(d.orders).map((wo) => {
        const { work, order } = workOrder(d, wo),
          milestone = d.blueprint.milestones.find((m) => m.id === order.milestone)!;
        return {
          id: wo,
          name: milestone.name,
          budgetMinor: milestone.budgetMinor,
          trancheId: order.trancheId,
          state: order.payment
            ? 'PAID'
            : order.submissionIntent?.status === 'RESERVED'
              ? 'SUBMITTING'
              : work.snapshot.state,
          payment: order.payment,
          submission: work.snapshot.submission,
          leasedUntil: work.snapshot.currentClaim?.leasedUntil ?? null,
        };
      }),
    };
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
        work.submit(claim.id, commit, 'reservation-only', now); // validate lease and commit before any HTTP
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
    return this.mutate(
      id,
      intent.actor,
      intent.reservedVersion,
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
        if (!same(order.submissionIntent, intent) || work.snapshot.currentClaim?.id !== intent.claimId || order.payment)
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
          completedVersion: intent.reservedVersion + 1,
        };
        return { wo, state: 'CHECKING', packageId, simulated: true };
      },
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
  settlement(id: string, wo: string, proof: SettlementProof, version: number) {
    return this.events.mutate(id, version, 'stood', `stood:${proof.eventId}`, fingerprint({ wo, proof }), (raw) => {
      const d = data(raw);
      const { work, order } = workOrder(d, wo);
      const m = d.blueprint.milestones.find((m) => m.id === order.milestone)!;
      if (
        work.snapshot.state !== 'CHECKING' ||
        order.payment ||
        proof.trancheId !== order.trancheId ||
        proof.packageId !== work.snapshot.submission?.packageId ||
        proof.effect !== 'CAPTURE' ||
        !proof.reference.trim() ||
        !proof.eventId.trim() ||
        proof.minor !== m.budgetMinor ||
        proof.currency !== d.blueprint.currency ||
        proof.simulated !== true
      )
        throw new YardError('INVALID');
      order.payment = structuredClone(proof);
      return {
        data: d,
        type: 'stood.released',
        payload: { wo, state: 'PAID', reference: proof.reference, payment: structuredClone(proof), simulated: true },
      };
    });
  }
}
