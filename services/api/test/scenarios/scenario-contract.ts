export const STEPS = [
  'DRAFT',
  'AUTHORIZE_FIXTURE',
  'DISPATCH',
  'PACKAGE',
  'ASSESS_FIXTURE',
  'EXECUTE',
  'RECONCILE',
  'RETRY_CAPTURE',
  'VERIFY',
  'RESTART',
  'ADVANCE_DAY_FOUR',
  'RENEW',
  'ADVANCE_EXPIRY',
  'EXPIRE',
  'REDISPATCH',
] as const;
const ASSESSMENTS = ['PASS', 'INTEGRITY_FAIL', 'WEAK_TESTS', 'USAGE_PENDING'] as const;
type Assessment = (typeof ASSESSMENTS)[number];
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
  assessment: Assessment;
  // Present only for one refusal followed by a fresh hold, package and assessment.
  reworkAssessment?: Assessment;
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
// Steps split at REDISPATCH into attempts. Each attempt runs a step at most once.
function attempts(steps: readonly unknown[]): unknown[][] {
  const out: unknown[][] = [[]];
  for (const step of steps) {
    if (step === 'REDISPATCH') out.push([]);
    else out.at(-1)?.push(step);
  }
  return out;
}
export function scenarioDefinition(value: unknown): Scenario {
  if (!object(value)) throw new Error('Invalid shared scenario');
  const rework = 'reworkAssessment' in value;
  const keys = `assessment,expected,id,profile,${rework ? 'reworkAssessment,' : ''}schemaVersion,steps`;
  const parts = Array.isArray(value.steps) ? attempts(value.steps) : [];
  if (
    Object.keys(value).sort().join() !== keys ||
    value.schemaVersion !== 1 ||
    typeof value.id !== 'string' ||
    !/^[a-z][a-z0-9-]{0,80}$/.test(value.id) ||
    !['code.milestone@1', 'code.final@1'].includes(String(value.profile)) ||
    !ASSESSMENTS.includes(value.assessment as Assessment) ||
    !Array.isArray(value.steps) ||
    value.steps.length > 2 * STEPS.length ||
    value.steps[0] !== 'DRAFT' ||
    value.steps.at(-1) !== 'VERIFY' ||
    value.steps.some((s) => !STEPS.includes(s)) ||
    parts.length !== (rework ? 2 : 1) ||
    parts.some((part) => new Set(part).size !== part.length) ||
    !object(value.expected)
  )
    throw new Error('Invalid shared scenario');
  if (
    rework &&
    (!ASSESSMENTS.includes(value.reworkAssessment as Assessment) ||
      !['INTEGRITY_FAIL', 'WEAK_TESTS'].includes(String(value.assessment)) ||
      parts[0]?.at(-1) !== 'RECONCILE' ||
      !parts[0]?.includes('EXECUTE') ||
      parts[1]?.[0] !== 'AUTHORIZE_FIXTURE' ||
      parts[1]?.includes('DRAFT'))
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
export function attemptAssessment(scenario: Scenario, attempt: number): Assessment {
  if (attempt === 1) return scenario.assessment;
  if (attempt === 2 && scenario.reworkAssessment) return scenario.reworkAssessment;
  throw new Error('No assessment for this attempt');
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
