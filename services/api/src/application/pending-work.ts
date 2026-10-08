type Keys = Readonly<{ unresolved(): Promise<readonly string[]> }>;

// T-0260: one worker step for saved-PayPal mandates and tranche funding. Each item is advanced by its own tested
// use case (advanceMandate, advanceFunding), which owns every PayPal call and every durable phase.
export async function advancePending(deps: {
  mandates: Keys;
  fundings: Keys;
  mandate(key: string): Promise<unknown>;
  fund(key: string): Promise<unknown>;
}): Promise<Readonly<{ mandates: number; fundings: number; failed: number }>> {
  const result = { mandates: 0, fundings: 0, failed: 0 };
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
        await step(key);
        result[count]++;
      } catch {
        result.failed++;
      }
    }
  }
  return result;
}
