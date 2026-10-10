import { randomUUID } from 'node:crypto';
import { YardError } from '../ports/events.js';
import type { PreviewHost } from '../ports/previews.js';
import type { Board } from './board.js';
import type { SecretVault } from './secret-vault.js';

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
    const env: Record<string, string> = {};
    // Each key is decrypted for this named deploy only, and the vault audits it before returning.
    for (const s of await this.vault.list(id, target.owner))
      env[s.name] = await this.vault.decryptForDeploy(id, s.name, { deployId, now });
    env.YARD_PREVIEW = 'simulated-test-data';
    const name = `yard-preview-${id}-${wo}`
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .slice(0, 60);
    const service = await this.host.deploy({ name, image, env });
    await this.board.recordPreview(id, {
      wo,
      serviceId: service.serviceId,
      url: service.url,
      expiresAt: target.expiresAt,
    });
    return { url: service.url, expiresAt: target.expiresAt };
  }
  // Tears down every expired preview across projects.
  async sweep(now: number): Promise<number> {
    let removed = 0;
    let after = '';
    do {
      const projects = await this.board.events.list(after);
      const page = projects.slice(0, 100);
      for (const p of page)
        for (const preview of await this.board.previewList(p.id))
          if (preview.expiresAt <= now) {
            await this.host.destroy(preview.serviceId);
            await this.board.removePreview(p.id, preview.serviceId, 'expired');
            removed++;
          }
      after = projects.length > 100 ? (page.at(-1)?.id ?? '') : '';
    } while (after);
    return removed;
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
