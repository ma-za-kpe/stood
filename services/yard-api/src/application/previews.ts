import { randomUUID } from 'node:crypto';
import { YardError } from '../ports/events.js';
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
      throw error;
    }
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
  async sweep(now: number): Promise<Readonly<{ expired: number; abandoned: number; orphaned: number }>> {
    let expired = 0,
      abandoned = 0,
      orphaned = 0;
    const services = await this.host.list();
    const tracked = new Set<string>();
    const pending = new Set<string>();
    let after = '';
    do {
      const projects = await this.board.events.list(after);
      const page = projects.slice(0, 100);
      for (const p of page) {
        for (const preview of await this.board.previewList(p.id))
          if (preview.expiresAt <= now) {
            await this.host.destroy(preview.serviceId);
            await this.board.removePreview(p.id, preview.serviceId, 'expired');
            tracked.add(preview.serviceId);
            expired++;
          } else tracked.add(preview.serviceId);
        for (const intent of await this.board.previewIntents(p.id))
          if (now - intent.at >= STALE_INTENT_MS) {
            await this.board.releasePreview(p.id, intent.deployId, 'abandoned');
            abandoned++;
          } else pending.add(intent.name);
      }
      after = projects.length > 100 ? (page.at(-1)?.id ?? '') : '';
    } while (after);
    for (const service of services)
      if (!tracked.has(service.serviceId) && !pending.has(service.name)) {
        await this.host.destroy(service.serviceId);
        orphaned++;
      }
    return { expired, abandoned, orphaned };
  }
  // Handover checklist item "previews deleted": removes every preview of a project.
  async closeOut(id: string, _now: number): Promise<number> {
    const previews = await this.board.previewList(id);
    for (const preview of previews) {
      await this.host.destroy(preview.serviceId);
      await this.board.removePreview(id, preview.serviceId, 'closed');
    }
    return previews.length;
  }
}
