export const STEPS = [
  'DRAFT',
  'AUTHORIZE_FIXTURE',
  'DISPATCH',
  'PACKAGE',
  'ASSESS_FIXTURE',
  'EXECUTE',
  'RECONCILE',
  'VERIFY',
  'RESTART',
  'ADVANCE_DAY_FOUR',
  'RENEW',
  'ADVANCE_EXPIRY',
  'EXPIRE',
] as const;
export type ScenarioStep = (typeof STEPS)[number];
type Expected = Readonly<{
  domainState: string;
  providerState: string;
  captures: number;
  settlementEffect: 'CAPTURE' | 'VOID' | 'EXPIRE' | null;
  ledgerStatus: 'CONFIRMED' | 'FAILED' | null;
}>;
export type Scenario = Readonly<{
  schemaVersion: 1;
  id: string;
  profile: string;
  assessment: 'PASS' | 'INTEGRITY_FAIL' | 'WEAK_TESTS' | 'USAGE_PENDING';
  steps: readonly ScenarioStep[];
  expected: Expected;
}>;
export type ScenarioEvidence = Expected &
  Readonly<{
    domainReference: string | null;
    ledgerReference: string | null;
    providerReference: string | null;
    simulated: boolean;
    moneyExecuted: false;
  }>;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export function scenarioDefinition(value: unknown): Scenario {
  if (
    !object(value) ||
    Object.keys(value).sort().join() !== 'assessment,expected,id,profile,schemaVersion,steps' ||
    value.schemaVersion !== 1 ||
    typeof value.id !== 'string' ||
    !/^[a-z][a-z0-9-]{0,80}$/.test(value.id) ||
    !['code.milestone@1', 'code.final@1'].includes(String(value.profile)) ||
    !['PASS', 'INTEGRITY_FAIL', 'WEAK_TESTS', 'USAGE_PENDING'].includes(String(value.assessment)) ||
    !Array.isArray(value.steps) ||
    value.steps.length > STEPS.length ||
    value.steps[0] !== 'DRAFT' ||
    value.steps.at(-1) !== 'VERIFY' ||
    new Set(value.steps).size !== value.steps.length ||
    value.steps.some((s) => !STEPS.includes(s)) ||
    !object(value.expected)
  )
    throw new Error('Invalid shared scenario');
  const e = value.expected;
  if (
    Object.keys(e).sort().join() !== 'captures,domainState,ledgerStatus,providerState,settlementEffect' ||
    !['RELEASED', 'REFUSED', 'WAITING', 'EXPIRED'].includes(String(e.domainState)) ||
    !['CREATED', 'CAPTURED', 'VOIDED', 'EXPIRED'].includes(String(e.providerState)) ||
    ![null, 'CAPTURE', 'VOID', 'EXPIRE'].includes(e.settlementEffect as string | null) ||
    ![null, 'CONFIRMED', 'FAILED'].includes(e.ledgerStatus as string | null) ||
    e.captures !== (e.settlementEffect === 'CAPTURE' ? 1 : 0)
  )
    throw new Error('Invalid expected money state');
  const combinations = {
    RELEASED: ['CAPTURED', 'CAPTURE', 'CONFIRMED'],
    REFUSED: ['VOIDED', 'VOID', 'CONFIRMED'],
    WAITING: ['CREATED', null, null],
    EXPIRED: ['EXPIRED', 'EXPIRE', 'FAILED'],
  };
  if (
    JSON.stringify(combinations[e.domainState as keyof typeof combinations]) !==
    JSON.stringify([e.providerState, e.settlementEffect, e.ledgerStatus])
  )
    throw new Error('Contradictory expected money state');
  return Object.freeze({
    ...value,
    steps: Object.freeze([...value.steps]),
    expected: Object.freeze({ ...e }),
  }) as Scenario;
}
export function assertScenarioEvidence(scenario: Scenario, actual: ScenarioEvidence): void {
  if (
    typeof actual.simulated !== 'boolean' ||
    actual.moneyExecuted !== false ||
    Object.entries(scenario.expected).some(([key, value]) => actual[key as keyof ScenarioEvidence] !== value)
  )
    throw new Error('Money state does not match the shared scenario');
  const references = [actual.domainReference, actual.ledgerReference, actual.providerReference];
  if (
    scenario.expected.settlementEffect
      ? references.some((r) => typeof r !== 'string' || !r.trim() || r !== references[0])
      : references.some((r) => r !== null)
  )
    throw new Error('Domain, ledger and provider references disagree');
}
export async function runScenario(
  scenario: Scenario,
  driver: {
    step(step: ScenarioStep, scenario: Scenario): Promise<void>;
    observe(): Promise<ScenarioEvidence>;
  },
) {
  const frozen = scenarioDefinition(scenario);
  for (const step of frozen.steps) await driver.step(step, frozen);
  const evidence = await driver.observe();
  assertScenarioEvidence(frozen, evidence);
  return evidence;
}
