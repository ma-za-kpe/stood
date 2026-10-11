type Keys = Readonly<{ unresolved(): Promise<readonly string[]> }>;
// What one step did: the item's durable status before and after it.
export type Step = Readonly<{ before: string; after: string }>;
// Statuses that end a mandate or funding without what was asked for.
const FAILED = new Set(['FAILED', 'EXPIRED', 'REVOKED', 'CANCELLED']);

// T-0260: one worker step for saved-PayPal mandates and tranche funding. Each item is advanced by its own tested
// use case (advanceMandate, advanceFunding), which owns every PayPal call and every durable phase.
// Second audit (2026-10-11): counts are state changes, not return values. Advanced means the durable status moved to
// a non-failed status; failed means it reached FAILED or EXPIRED (or the step threw); anything that did not move,
// such as a funding still AWAITING_APPROVAL, is waiting.
export async function advancePending(deps: {
  mandates: Keys;
  fundings: Keys;
  mandate(key: string): Promise<Step>;
  fund(key: string): Promise<Step>;
}): Promise<Readonly<{ mandates: number; fundings: number; waiting: number; failed: number }>> {
  const result = { mandates: 0, fundings: 0, waiting: 0, failed: 0 };
  for (const [keys, step, count] of [
    [deps.mandates, deps.mandate, 'mandates'],
    [deps.fundings, deps.fund, 'fundings'],
  ] as const) {
    let list: readonly string[];
    try {
      list = await keys.unresolved();
    } catch {
      result.failed++;
      continue;
    }
    for (const key of list) {
      try {
        const { before, after } = await step(key);
        if (before === after) result.waiting++;
        else if (FAILED.has(after)) result.failed++;
        else result[count]++;
      } catch {
        result.failed++;
      }
    }
  }
  return result;
}
