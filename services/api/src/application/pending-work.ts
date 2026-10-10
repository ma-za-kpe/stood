type Keys = Readonly<{ unresolved(): Promise<readonly string[]> }>;

// T-0260: one worker step for saved-PayPal mandates and tranche funding. Each item is advanced by its own tested
// use case (advanceMandate, advanceFunding), which owns every PayPal call and every durable phase.
// Audit 2026-10-10: a step that answered WAIT moved nothing, so it is counted as waiting, not advanced; the log said
// "2 fundings advanced" for two fundings stuck in CREATING.
const waited = (outcome: unknown) =>
  outcome === 'WAIT' ||
  (typeof outcome === 'object' && outcome !== null && (outcome as { outcome?: unknown }).outcome === 'WAIT');

export async function advancePending(deps: {
  mandates: Keys;
  fundings: Keys;
  mandate(key: string): Promise<unknown>;
  fund(key: string): Promise<unknown>;
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
        if (waited(await step(key))) result.waiting++;
        else result[count]++;
      } catch {
        result.failed++;
      }
    }
  }
  return result;
}
