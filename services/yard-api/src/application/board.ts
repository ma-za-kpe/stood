import { Blueprint, type BlueprintInput, costDisclosure, type FreezeProof, WorkOrder } from '@stood/yard-domain';
import { YardError, type YardEvent, type YardEvents, type YardSnapshot } from '../ports/events.js';
import type { BoardContext } from './board-context.js';
import { BoardMandates } from './board-mandates.js';
import { BoardPayouts } from './board-payouts.js';
import { BoardPreviews } from './board-previews.js';
import { BoardProofs } from './board-proofs.js';
import {
  type AwaitingStood,
  BUILDER_EVENTS,
  beforeDeadline,
  currentHold,
  type Data,
  data,
  feedback,
  field,
  fingerprint,
  type HoldProof,
  leaseChange,
  MAX_ACTIVE_CLAIMS,
  type MilestoneChange,
  type Operator,
  offerId,
  open,
  payee,
  payoutDueAt,
  punchList,
  type RefusalProof,
  type SettlementProof,
  same,
  status,
  terms,
  workOrder,
} from './board-state.js';
import { BoardSubmissions } from './board-submissions.js';
import { BoardWorkOrders } from './board-workorders.js';

export {
  type AwaitingStood,
  HOLDBACK_MS,
  type HoldProof,
  MAX_ACTIVE_CLAIMS,
  type MandateIntent,
  type MandateLine,
  type MandateRequest,
  type MilestoneChange,
  type Operator,
  offerId,
  type Payout,
  type PayoutAction,
  type PayoutStatus,
  type PunchItem,
  type RefusalProof,
  type SettlementProof,
  type StoodProof,
  type SubmissionIntent,
  yardFee,
} from './board-state.js';

export class Board {
  private readonly workOrders: BoardWorkOrders;
  private readonly proofs: BoardProofs;
  private readonly previews: BoardPreviews;
  private readonly payouts: BoardPayouts;
  private readonly mandates: BoardMandates;
  private readonly submissions: BoardSubmissions;
  constructor(
    readonly events: YardEvents,
    private readonly limits: Readonly<{ maxActiveClaims: number; payee?: string; feeBps?: number }> = {
      maxActiveClaims: MAX_ACTIVE_CLAIMS,
    },
  ) {
    const context: BoardContext = {
      events,
      limits,
      mutate: this.mutate.bind(this),
      atCurrent: this.atCurrent.bind(this),
      read: this.read.bind(this),
      submit: this.submit.bind(this),
      activeClaims: this.activeClaims.bind(this),
    };
    this.proofs = new BoardProofs(events);
    this.workOrders = new BoardWorkOrders(context);
    this.previews = new BoardPreviews(events);
    this.payouts = new BoardPayouts(events);
    this.mandates = new BoardMandates(context);
    this.submissions = new BoardSubmissions(context);
  }
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
  previewTarget(...args: Parameters<BoardPreviews['previewTarget']>) {
    return this.previews.previewTarget(...args);
  }
  reservePreview(...args: Parameters<BoardPreviews['reservePreview']>) {
    return this.previews.reservePreview(...args);
  }
  releasePreview(...args: Parameters<BoardPreviews['releasePreview']>) {
    return this.previews.releasePreview(...args);
  }
  previewIntents(...args: Parameters<BoardPreviews['previewIntents']>) {
    return this.previews.previewIntents(...args);
  }
  recordPreview(...args: Parameters<BoardPreviews['recordPreview']>) {
    return this.previews.recordPreview(...args);
  }
  removePreview(...args: Parameters<BoardPreviews['removePreview']>) {
    return this.previews.removePreview(...args);
  }
  previewList(...args: Parameters<BoardPreviews['previewList']>) {
    return this.previews.previewList(...args);
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
  prepareMandate(...args: Parameters<BoardMandates['prepareMandate']>) {
    return this.mandates.prepareMandate(...args);
  }
  completeMandate(...args: Parameters<BoardMandates['completeMandate']>) {
    return this.mandates.completeMandate(...args);
  }
  pendingMandates(...args: Parameters<BoardMandates['pendingMandates']>) {
    return this.mandates.pendingMandates(...args);
  }
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
  freeze(...args: Parameters<BoardWorkOrders['freeze']>) {
    return this.workOrders.freeze(...args);
  }
  post(...args: Parameters<BoardWorkOrders['post']>) {
    return this.workOrders.post(...args);
  }
  claim(...args: Parameters<BoardWorkOrders['claim']>) {
    return this.workOrders.claim(...args);
  }
  build(...args: Parameters<BoardWorkOrders['build']>) {
    return this.workOrders.build(...args);
  }
  expireLease(...args: Parameters<BoardWorkOrders['expireLease']>) {
    return this.workOrders.expireLease(...args);
  }
  releaseClaim(...args: Parameters<BoardWorkOrders['releaseClaim']>) {
    return this.workOrders.releaseClaim(...args);
  }
  repost(...args: Parameters<BoardWorkOrders['repost']>) {
    return this.workOrders.repost(...args);
  }
  submit(...args: Parameters<BoardWorkOrders['submit']>) {
    return this.workOrders.submit(...args);
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
  pendingSubmissions(...args: Parameters<BoardSubmissions['pendingSubmissions']>) {
    return this.submissions.pendingSubmissions(...args);
  }
  prepareSubmission(...args: Parameters<BoardSubmissions['prepareSubmission']>) {
    return this.submissions.prepareSubmission(...args);
  }
  completeSubmission(...args: Parameters<BoardSubmissions['completeSubmission']>) {
    return this.submissions.completeSubmission(...args);
  }
  submissionTerms(...args: Parameters<BoardSubmissions['submissionTerms']>) {
    return this.submissions.submissionTerms(...args);
  }
  settlement(...args: Parameters<BoardProofs['settlement']>) {
    return this.proofs.settlement(...args);
  }
  holdConfirmed(...args: Parameters<BoardProofs['holdConfirmed']>) {
    return this.proofs.holdConfirmed(...args);
  }
  refusal(...args: Parameters<BoardProofs['refusal']>) {
    return this.proofs.refusal(...args);
  }
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
  payoutsDue(...args: Parameters<BoardPayouts['payoutsDue']>) {
    return this.payouts.payoutsDue(...args);
  }
  reservePayout(...args: Parameters<BoardPayouts['reservePayout']>) {
    return this.payouts.reservePayout(...args);
  }
  payoutUpdate(...args: Parameters<BoardPayouts['payoutUpdate']>) {
    return this.payouts.payoutUpdate(...args);
  }
  payoutAction(...args: Parameters<BoardPayouts['payoutAction']>) {
    return this.payouts.payoutAction(...args);
  }
  payoutsOpen(...args: Parameters<BoardPayouts['payoutsOpen']>) {
    return this.payouts.payoutsOpen(...args);
  }
  payoutAttention(...args: Parameters<BoardPayouts['payoutAttention']>) {
    return this.payouts.payoutAttention(...args);
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
}
