import type { AllowanceVersionView, MandateView } from '@stood/stood-sdk';
import { Blueprint } from '@stood/yard-domain';
import { YardError } from '../ports/events.js';
import type { AmendmentIntent, EvidenceChange } from './board-amendment-types.js';
import type { BoardContext } from './board-context.js';
import { data, fingerprint, type Operator, same, terms } from './board-state.js';
export class BoardAmendments {
  constructor(private readonly context: BoardContext) {}
  async reserve(id: string, actor: Operator, version: number, key: string, changes: readonly EvidenceChange[]) {
    const snapshot = await this.context.read(id, actor);
    const current = data(snapshot.data);
    if (actor.kind !== 'BUYER' || current.blueprint.buyerOperatorId !== actor.id || current.buyerRoot !== actor.root)
      throw new YardError('FORBIDDEN');
    const requestKey = `yard-amendment:${fingerprint({ id, actor, key })}`;
    if (!Array.isArray(changes)) throw new YardError('INVALID');
    const inputHash = fingerprint(changes);
    const existing = current.amendments?.find((a) => a.key === requestKey);
    if (existing) {
      if (existing.inputHash !== inputHash) throw new YardError('CONFLICT');
      return structuredClone(existing);
    }
    const stored = await this.context.mutate(
      id,
      actor,
      version,
      `amendment-reserve:${key}`,
      { changes },
      'stood.amendment_reserved',
      (d) => {
        if (
          !d.mandate?.allowanceId ||
          !d.mandate.tranches ||
          d.mandate.status !== 'CREATED' ||
          d.handover ||
          d.blueprint.status !== 'FROZEN' ||
          d.amendments?.some((a) => a.status === 'RESERVED') ||
          d.changes?.some((c) => c.status === 'PROPOSED')
        )
          throw new YardError('CONFLICT');
        if (
          !Array.isArray(changes) ||
          !changes.length ||
          changes.length > d.blueprint.milestones.length ||
          new Set(changes.map((c) => c?.milestoneId)).size !== changes.length
        )
          throw new YardError('INVALID');
        const request = {
          ...structuredClone(d.mandate.request),
          milestones: [...structuredClone(d.mandate.request.milestones)],
        };
        const proposed = d.blueprint.milestones.map((m) => terms(d, m.id) ?? m);
        for (const change of changes) {
          if (!change || Object.keys(change).sort().join() !== 'manifestHash,milestoneId,testBundleHash,testIds,tests')
            throw new YardError('INVALID');
          const i = proposed.findIndex((m) => m.id === change.milestoneId);
          const milestone = proposed[i];
          if (!milestone) throw new YardError('INVALID');
          if (d.orders[change.milestoneId] || d.mandate.amendmentRequired?.includes(change.milestoneId))
            throw new YardError('CONFLICT');
          const { milestoneId: _id, ...evidence } = change;
          proposed[i] = { ...milestone, ...evidence };
          const original = request.milestones[i];
          if (!original || original.name !== milestone.name) throw new YardError('CONFLICT');
          const params = { ...original.params, ...evidence };
          if (same(params, original.params)) throw new YardError('INVALID');
          request.milestones[i] = { ...original, params };
        }
        try {
          Blueprint.create({ ...d.blueprint, milestones: proposed });
        } catch {
          throw new YardError('INVALID');
        }
        const intent: AmendmentIntent = {
          key: requestKey,
          inputHash,
          allowanceId: d.mandate.allowanceId,
          expectedVersion: d.mandate.termsVersion ?? 1,
          request,
          changes: structuredClone(changes),
          status: 'RESERVED',
        };
        d.amendments = [...(d.amendments ?? []), intent];
        d.mandate.amendmentRequired = [
          ...new Set([...(d.mandate.amendmentRequired ?? []), ...changes.map((c) => c.milestoneId)]),
        ];
        return { key: requestKey, milestones: changes.map((c) => c.milestoneId) };
      },
    );
    return structuredClone(data(stored.data).amendments?.find((a) => a.key === requestKey) as AmendmentIntent);
  }
  record(
    id: string,
    key: string,
    receipt: AllowanceVersionView | null,
    signing: MandateView | null,
    rejected = false,
  ): Promise<AmendmentIntent> {
    return this.context.atCurrent(id, async (version) => {
      const snapshot = await this.context.events.mutate(
        id,
        version,
        'stood',
        `amendment-result:${fingerprint({ key, receipt, signing, rejected })}`,
        fingerprint({ key, receipt, signing, rejected }),
        (raw) => {
          const d = data(raw);
          const intent = d.amendments?.find((a) => a.key === key);
          if (!intent || !d.mandate?.tranches) throw new YardError('NOT_FOUND');
          if (intent.status !== 'RESERVED') throw new YardError('CONFLICT');
          if (rejected) {
            if (intent.receipt || signing || receipt) throw new YardError('CONFLICT');
            intent.status = 'NEEDS_REVISION';
          } else {
            if (
              !receipt ||
              receipt.version !== intent.expectedVersion + 1 ||
              !/^[a-f0-9]{64}$/.test(receipt.termsHash) ||
              !same(receipt.body, {
                ...intent.request,
                id: intent.allowanceId,
                status: 'DRAFT',
                tranches: d.blueprint.milestones.map((m, i) => ({
                  id: d.mandate?.tranches?.[m.id],
                  name: intent.request.milestones[i]?.name,
                })),
              })
            )
              throw new YardError('INVALID');
            if (intent.receipt && !same(intent.receipt, { version: receipt.version, termsHash: receipt.termsHash }))
              throw new YardError('CONFLICT');
            intent.receipt = { version: receipt.version, termsHash: receipt.termsHash };
            if (signing) {
              if (signing.key !== (intent.signingKey ?? `${key}:consent`)) throw new YardError('INVALID');
              intent.signing = structuredClone(signing);
              if (signing.status === 'SIGNED') {
                if (intent.changes.some((c) => d.orders[c.milestoneId])) throw new YardError('CONFLICT');
                intent.status = 'SIGNED';
                d.mandate = { ...d.mandate, request: structuredClone(intent.request), termsVersion: receipt.version };
              }
            }
          }
          if (intent.status !== 'RESERVED')
            d.mandate.amendmentRequired = (d.mandate.amendmentRequired ?? []).filter(
              (milestone) => !intent.changes.some((c) => c.milestoneId === milestone),
            );
          return {
            data: d,
            type: 'stood.amendment_updated',
            payload: { key, status: intent.status, version: intent.receipt?.version ?? null },
          };
        },
      );
      return structuredClone(data(snapshot.data).amendments?.find((a) => a.key === key) as AmendmentIntent);
    });
  }
  async renew(id: string, actor: Operator, version: number, key: string, amendmentKey: string) {
    const snapshot = await this.context.mutate(
      id,
      actor,
      version,
      `amendment-renew:${key}`,
      { amendmentKey },
      'stood.amendment_consent_renewed',
      (d) => {
        if (actor.kind !== 'BUYER' || d.blueprint.buyerOperatorId !== actor.id || d.buyerRoot !== actor.root)
          throw new YardError('FORBIDDEN');
        const intent = d.amendments?.find((a) => a.key === amendmentKey);
        if (!intent || intent.status !== 'RESERVED' || intent.signing?.status !== 'REVOKED' || !intent.receipt)
          throw new YardError('CONFLICT');
        intent.signingKey = `yard-amendment-consent:${fingerprint({ amendmentKey, actor, key })}`;
        delete intent.signing;
        return { key: amendmentKey, version: intent.receipt.version };
      },
    );
    return structuredClone(data(snapshot.data).amendments?.find((a) => a.key === amendmentKey) as AmendmentIntent);
  }
  async pending(after = '') {
    const projects = await this.context.events.list(after),
      page = projects.slice(0, 100);
    return {
      items: page.flatMap((p) =>
        (data(p.data).amendments ?? [])
          .filter((a) => a.status === 'RESERVED')
          .map((intent) => ({ projectId: p.id, intent: structuredClone(intent) })),
      ),
      nextCursor: projects.length > 100 ? (page.at(-1)?.id ?? null) : null,
    };
  }
}
