import { YardError } from '../ports/events.js';
import type { BoardContext } from './board-context.js';
import {
  data,
  fingerprint,
  type MandateIntent,
  type MandateLine,
  type MandateRequest,
  type Operator,
  payee,
  same,
  status,
  terms,
  yardFee,
} from './board-state.js';

export class BoardMandates {
  constructor(private readonly context: BoardContext) {}
  async prepareMandate(id: string, actor: Operator, version: number, key: string, now: number): Promise<MandateIntent> {
    const current = await this.context.events.load(id);
    const existing = data(current.data).mandate;
    if (existing) {
      if (existing.key !== `yard-mandate:${fingerprint({ id, actor, key })}`) throw new YardError('CONFLICT');
      return structuredClone(existing);
    }
    const snapshot = await this.context.mutate(
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
        const feeBps = this.context.limits.feeBps ?? 0;
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
          payee_ref: this.context.limits.payee ?? `yard:${id}`,
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
    return this.context.atCurrent(id, (version) =>
      this.context.events.mutate(
        id,
        version,
        'stood',
        `mandate-complete:${intent.key}`,
        fingerprint({ draft }),
        (raw) => {
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
        },
      ),
    );
  }
  async pendingMandates(after = '') {
    const projects = await this.context.events.list(after),
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
}
