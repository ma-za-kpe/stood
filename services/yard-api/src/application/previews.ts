import { randomUUID } from 'node:crypto';
import { YardError } from '../ports/events.js';
import type { PreviewSlots } from '../ports/preview-slots.js';
import type { PreviewHost } from '../ports/previews.js';
import type { Board } from './board.js';
import type { SecretVault } from './secret-vault.js';

// A deploy reserved this long ago and still unrecorded has failed or crashed.
const STALE_INTENT_MS = 15 * 60_000;
const DIGEST = /^[a-z0-9][a-z0-9._/-]{0,200}@sha256:[a-f0-9]{64}$/;
// Y20 option C previews: Yard's workspace, the exact checked image, the buyer's TEST/DEV keys only.
export class Previews {
  constructor(
    private readonly board: Board,
    private readonly vault: SecretVault,
    private readonly host: PreviewHost,
    // The global cap on live previews (sixth audit, 2026-10-11): reserved atomically before Render is called.
    private readonly cap?: Readonly<{ slots: PreviewSlots; max: number }>,
  ) {}
  async deploy(id: string, wo: string, image: string, now: number) {
    if (!DIGEST.test(image)) throw new YardError('INVALID');
    const target = await this.board.previewTarget(id, wo, now);
    // A retry, or a second click, returns the live preview instead of starting another service.
    const live = (await this.board.previewList(id)).find((p) => p.wo === wo && p.expiresAt > now);
    if (live) return { url: live.url, expiresAt: live.expiresAt };
    const deployId = `preview-${randomUUID()}`;
    const name = `yard-preview-${id}-${wo}`
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .slice(0, 60);
    // Fifth audit (2026-10-11): reserve before Render is called. A racing request is refused (CONFLICT); a crash
    // after the service exists leaves this intent, and the sweep removes the service and the intent.
    await this.board.reservePreview(id, { wo, deployId, name, at: now }, now);
    if (this.cap && !(await this.cap.slots.reserve(deployId, this.cap.max, now))) {
      await this.board.releasePreview(id, deployId, 'failed').catch(() => undefined);
      throw new YardError('CONFLICT');
    }
    let service: Readonly<{ serviceId: string; url: string }>;
    try {
      const env: Record<string, string> = {};
      // Each key is decrypted for this named deploy only, and the vault audits it before returning.
      for (const s of await this.vault.list(id, target.owner, now))
        env[s.name] = await this.vault.decryptForDeploy(id, s.name, { deployId, now });
      env.YARD_PREVIEW = 'simulated-test-data';
      service = await this.host.deploy({ name, image, env });
    } catch (error) {
      // Render may still have made the service (a lost reply); the sweep finds it untracked and deletes it.
      await this.board.releasePreview(id, deployId, 'failed').catch(() => undefined);
      await this.cap?.slots.release({ deployId }).catch(() => undefined);
      throw error;
    }
    await this.cap?.slots.attach(deployId, service.serviceId);
    await this.board.recordPreview(
      id,
      { wo, serviceId: service.serviceId, url: service.url, expiresAt: target.expiresAt },
      deployId,
    );
    return { url: service.url, expiresAt: target.expiresAt };
  }
  // Every hour: deletes expired previews; drops reservations a crashed deploy left behind; and deletes any Yard preview
  // service on Render that no project tracks (created, then never recorded). A fresh reservation's service is spared.
  // Render is listed first: a deploy reserves before it creates, so any listed service's reservation or record is
  // already visible when the projects are read after it.
  async sweep(
    now: number,
  ): Promise<Readonly<{ expired: number; abandoned: number; orphaned: number; failed: number }>> {
    let expired = 0,
      abandoned = 0,
      orphaned = 0,
      failed = 0;
    // Sixth audit (2026-10-11): one preview's failure is counted and the sweep goes on to the rest.
    const each = async (work: () => Promise<void>) => {
      try {
        await work();
      } catch {
        failed++;
      }
    };
    const services = await this.host.list();
    // Slots whose service is gone from Render free their capacity, whatever failed to release them.
    await each(async () => {
      await this.cap?.slots.retain(services.map((service) => service.serviceId));
    });
    const tracked = new Set<string>();
    const pending = new Set<string>();
    let after = '';
    do {
      const projects = await this.board.events.list(after);
      const page = projects.slice(0, 100);
      for (const p of page) {
        for (const preview of await this.board.previewList(p.id))
          if (preview.expiresAt <= now) {
            tracked.add(preview.serviceId);
            await each(async () => {
              await this.host.destroy(preview.serviceId);
              await this.board.removePreview(p.id, preview.serviceId, 'expired');
              await this.cap?.slots.release({ serviceId: preview.serviceId });
              expired++;
            });
          } else tracked.add(preview.serviceId);
        for (const intent of await this.board.previewIntents(p.id))
          if (now - intent.at >= STALE_INTENT_MS)
            await each(async () => {
              await this.board.releasePreview(p.id, intent.deployId, 'abandoned');
              await this.cap?.slots.release({ deployId: intent.deployId });
              abandoned++;
            });
          else pending.add(intent.name);
      }
      after = projects.length > 100 ? (page.at(-1)?.id ?? '') : '';
    } while (after);
    for (const service of services)
      if (!tracked.has(service.serviceId) && !pending.has(service.name))
        await each(async () => {
          await this.host.destroy(service.serviceId);
          await this.cap?.slots.release({ serviceId: service.serviceId });
          orphaned++;
        });
    return { expired, abandoned, orphaned, failed };
  }
  // Handover checklist item "previews deleted": removes every preview of a project.
  async closeOut(id: string, _now: number): Promise<number> {
    const previews = await this.board.previewList(id);
    for (const preview of previews) {
      await this.host.destroy(preview.serviceId);
      await this.board.removePreview(id, preview.serviceId, 'closed');
      await this.cap?.slots.release({ serviceId: preview.serviceId });
    }
    return previews.length;
  }
}
