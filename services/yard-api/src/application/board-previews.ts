import type { YardEvents } from '../ports/events.js';
import { YardError } from '../ports/events.js';
import { data, fingerprint, workOrder } from './board-state.js';

export class BoardPreviews {
  constructor(private readonly events: YardEvents) {}
  async previewTarget(id: string, wo: string, now: number) {
    const snapshot = await this.events.load(id),
      d = data(snapshot.data);
    const { work, order } = workOrder(d, wo);
    if (!['CHECKING', 'REWORK'].includes(work.snapshot.state) && !order.payment) throw new YardError('CONFLICT');
    return { owner: snapshot.owner, expiresAt: order.payment ? now + 7 * 86400000 : now + 30 * 86400000 };
  }
  // One deploy at a time per work order: the reservation is a version-checked write, so of two racing requests one
  // reserves and the other sees it (CONFLICT). A live preview is reused by the caller before it reserves.
  async reservePreview(id: string, intent: { wo: string; deployId: string; name: string; at: number }, now: number) {
    // Another write to the project between load and mutate (a racing deploy among them) is retried on the new
    // version, where the racing reservation, if any, is seen.
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.reserveOnce(id, intent, now);
      } catch (error) {
        if (!(error instanceof YardError) || error.code !== 'STALE_VERSION' || attempt === 5) throw error;
      }
    }
  }
  private async reserveOnce(
    id: string,
    intent: { wo: string; deployId: string; name: string; at: number },
    now: number,
  ) {
    const snapshot = await this.events.load(id);
    return this.events.mutate(
      id,
      snapshot.version,
      'yard',
      `preview-intent:${intent.deployId}`,
      fingerprint(intent),
      (raw) => {
        const d = data(raw);
        workOrder(d, intent.wo);
        if (
          (d.previews ?? []).some((p) => p.wo === intent.wo && p.expiresAt > now) ||
          (d.previewIntents ?? []).some((p) => p.wo === intent.wo)
        )
          throw new YardError('CONFLICT');
        d.previewIntents = [...(d.previewIntents ?? []), structuredClone(intent)];
        return { data: d, type: 'preview.reserved', payload: { wo: intent.wo, simulated: true } };
      },
    );
  }
  async releasePreview(id: string, deployId: string, reason: 'failed' | 'abandoned') {
    const snapshot = await this.events.load(id);
    return this.events.mutate(
      id,
      snapshot.version,
      'yard',
      `preview-released:${deployId}`,
      fingerprint({ deployId, reason }),
      (raw) => {
        const d = data(raw);
        const p = d.previewIntents?.find((x) => x.deployId === deployId);
        if (!p) throw new YardError('NOT_FOUND');
        d.previewIntents = d.previewIntents?.filter((x) => x.deployId !== deployId) ?? [];
        return { data: d, type: 'preview.released', payload: { wo: p.wo, reason, simulated: true } };
      },
    );
  }
  async previewIntents(id: string) {
    return structuredClone(data((await this.events.load(id)).data).previewIntents ?? []);
  }
  async recordPreview(
    id: string,
    preview: { wo: string; serviceId: string; url: string; expiresAt: number },
    deployId?: string,
  ) {
    const snapshot = await this.events.load(id);
    return this.events.mutate(
      id,
      snapshot.version,
      'yard',
      `preview:${preview.serviceId}`,
      fingerprint(preview),
      (raw) => {
        const d = data(raw);
        workOrder(d, preview.wo);
        if (deployId) d.previewIntents = d.previewIntents?.filter((x) => x.deployId !== deployId) ?? [];
        d.previews = [...(d.previews ?? []), structuredClone(preview)];
        return {
          data: d,
          type: 'preview.deployed',
          payload: { wo: preview.wo, url: preview.url, expiresAt: preview.expiresAt, simulated: true },
        };
      },
    );
  }
  async removePreview(id: string, serviceId: string, reason: 'expired' | 'closed') {
    const snapshot = await this.events.load(id);
    return this.events.mutate(
      id,
      snapshot.version,
      'yard',
      `preview-removed:${serviceId}`,
      fingerprint({ serviceId, reason }),
      (raw) => {
        const d = data(raw);
        const p = d.previews?.find((x) => x.serviceId === serviceId);
        if (!p) throw new YardError('NOT_FOUND');
        d.previews = d.previews?.filter((x) => x.serviceId !== serviceId) ?? [];
        return { data: d, type: 'preview.expired', payload: { wo: p.wo, reason, simulated: true } };
      },
    );
  }
  async previewList(id: string) {
    return structuredClone(data((await this.events.load(id)).data).previews ?? []);
  }
}
