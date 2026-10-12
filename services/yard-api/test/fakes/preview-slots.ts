import { type PreviewSlots, SLOT_GRACE_MS } from '../../src/ports/preview-slots.js';

// In-memory slots with the same rules as Postgres; reserve is a single synchronous step, so it is atomic here too.
export class MemoryPreviewSlots implements PreviewSlots {
  readonly slots = new Map<string, { serviceId: string | null; reservedAt: number }>();
  async reserve(deployId: string, max: number, now: number) {
    const live = [...this.slots.values()].filter((s) => s.serviceId !== null || s.reservedAt > now - SLOT_GRACE_MS);
    if (live.length >= max) return false;
    if (!this.slots.has(deployId)) this.slots.set(deployId, { serviceId: null, reservedAt: now });
    return true;
  }
  async attach(deployId: string, serviceId: string) {
    const slot = this.slots.get(deployId);
    if (slot) slot.serviceId = serviceId;
  }
  async release(by: Readonly<{ deployId?: string; serviceId?: string }>) {
    for (const [id, slot] of this.slots)
      if ((by.deployId && id === by.deployId) || (by.serviceId && slot.serviceId === by.serviceId))
        this.slots.delete(id);
  }
  async retain(liveServiceIds: readonly string[]) {
    let dropped = 0;
    for (const [id, slot] of this.slots)
      if (slot.serviceId !== null && !liveServiceIds.includes(slot.serviceId)) {
        this.slots.delete(id);
        dropped++;
      }
    return dropped;
  }
}
