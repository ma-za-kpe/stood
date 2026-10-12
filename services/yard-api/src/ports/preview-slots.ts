// Sixth audit (2026-10-11): the cap on live previews is global, so it is reserved atomically before Render is called.
// A slot is held by a deploy, then by the service it made; one that never got a service stops counting after the
// grace period, and the sweep drops slots whose service is gone from the host.
export interface PreviewSlots {
  reserve(deployId: string, max: number, now: number): Promise<boolean>;
  attach(deployId: string, serviceId: string): Promise<void>;
  release(by: Readonly<{ deployId?: string; serviceId?: string }>): Promise<void>;
  retain(liveServiceIds: readonly string[]): Promise<number>;
}
export const SLOT_GRACE_MS = 15 * 60_000;
