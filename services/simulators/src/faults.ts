export type FaultKind = 'HTTP_500' | 'RATE_LIMIT' | 'MALFORMED' | 'TIMEOUT' | 'LOST_RESPONSE';
export type Fault = Readonly<{ method: string; path: string; kind: FaultKind; phase?: 'before' | 'after' }>;
export class FaultController {
  private readonly plan: Fault[];
  private readonly waiting = new Set<() => void>();
  constructor(plan: readonly Fault[]) {
    if (
      plan.some(
        (f) =>
          !['GET', 'POST', 'DELETE'].includes(f.method) ||
          !/^\/v[123]\/[A-Za-z0-9/_-]+$/.test(f.path) ||
          !['HTTP_500', 'RATE_LIMIT', 'MALFORMED', 'TIMEOUT', 'LOST_RESPONSE'].includes(f.kind) ||
          (f.phase !== undefined && !['before', 'after'].includes(f.phase)) ||
          (f.kind === 'LOST_RESPONSE' && f.phase === 'before'),
      )
    )
      throw new Error('Invalid simulator fault plan');
    this.plan = plan.map((f) => Object.freeze({ ...f }));
  }
  take(method: string, path: string): Fault | null {
    const index = this.plan.findIndex((f) => f.method === method && f.path === path);
    if (index < 0) return null;
    const fault = this.plan.splice(index, 1)[0];
    return fault
      ? Object.freeze({ ...fault, phase: fault.phase ?? (fault.kind === 'LOST_RESPONSE' ? 'after' : 'before') })
      : null;
  }
  wait(): Promise<void> {
    return new Promise((resolve) => this.waiting.add(resolve));
  }
  release(): void {
    for (const resolve of this.waiting) resolve();
    this.waiting.clear();
  }
}
export function replayEvents<T>(events: readonly T[], indices: readonly number[]): T[] {
  if (indices.some((i) => !Number.isInteger(i) || i < 0 || i >= events.length))
    throw new Error('Invalid simulator event order');
  return indices.map((i) => structuredClone(events[i] as T));
}
