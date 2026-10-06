import { readdirSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { assertScenarioEvidence, attemptAssessment, scenarioDefinition } from './scenario-contract.js';

it('validates every shared Stood flow and refuses capture/reference contradictions', () => {
  for (const path of readdirSync('services/api/test/scenarios/stood')) {
    const scenario = scenarioDefinition(JSON.parse(readFileSync(`services/api/test/scenarios/stood/${path}`, 'utf8')));
    const evidence = {
      ...scenario.expected,
      domainReference: scenario.expected.settlementEffect ? 'proof' : null,
      ledgerReference: scenario.expected.settlementEffect ? 'proof' : null,
      providerReference: scenario.expected.settlementEffect ? 'proof' : null,
      simulated: true,
      moneyExecuted: false as const,
    };
    expect(() => assertScenarioEvidence(scenario, evidence)).not.toThrow();
    expect(() => assertScenarioEvidence(scenario, { ...evidence, captures: 2 })).toThrow();
    if (scenario.expected.settlementEffect)
      expect(() => assertScenarioEvidence(scenario, { ...evidence, providerReference: 'foreign' })).toThrow();
    expect(() => scenarioDefinition({ ...scenario, steps: [...scenario.steps, 'capture_arbitrarily'] })).toThrow();
  }
});

const reworked = {
  schemaVersion: 1,
  id: 'rework-example',
  profile: 'code.milestone@1',
  assessment: 'INTEGRITY_FAIL',
  reworkAssessment: 'PASS',
  steps: [
    'DRAFT',
    'AUTHORIZE_FIXTURE',
    'DISPATCH',
    'PACKAGE',
    'ASSESS_FIXTURE',
    'EXECUTE',
    'RECONCILE',
    'REDISPATCH',
    'AUTHORIZE_FIXTURE',
    'DISPATCH',
    'PACKAGE',
    'ASSESS_FIXTURE',
    'EXECUTE',
    'RECONCILE',
    'VERIFY',
  ],
  expected: {
    domainState: 'RELEASED',
    providerState: 'CAPTURED',
    captures: 1,
    settlementEffect: 'CAPTURE',
    ledgerStatus: 'CONFIRMED',
  },
};
it('allows exactly one refusal-driven redispatch with a fresh hold, package and assessment (T-0232)', () => {
  const scenario = scenarioDefinition(reworked);
  expect(attemptAssessment(scenario, 1)).toBe('INTEGRITY_FAIL');
  expect(attemptAssessment(scenario, 2)).toBe('PASS');
  expect(() => attemptAssessment(scenario, 3)).toThrow();
  const single = JSON.parse(readFileSync('services/api/test/scenarios/stood/signed-tests-changed.json', 'utf8'));
  expect(attemptAssessment(scenarioDefinition(single), 1)).toBe('INTEGRITY_FAIL');
  expect(() => attemptAssessment(scenarioDefinition(single), 2)).toThrow();
  const without = { ...reworked } as Record<string, unknown>;
  delete without.reworkAssessment;
  for (const invalid of [
    without,
    { ...reworked, steps: reworked.steps.filter((s) => s !== 'REDISPATCH') },
    { ...reworked, assessment: 'PASS' },
    { ...reworked, assessment: 'USAGE_PENDING' },
    { ...reworked, reworkAssessment: 'SKIP' },
    { ...reworked, steps: [...reworked.steps.slice(0, 8), 'REDISPATCH', ...reworked.steps.slice(8)] },
    { ...reworked, steps: [...reworked.steps.slice(0, 8), 'DRAFT', ...reworked.steps.slice(8)] },
    { ...reworked, steps: reworked.steps.filter((s, i) => !(s === 'RECONCILE' && i === 6)) },
    { ...reworked, steps: [...reworked.steps.slice(0, 9), 'AUTHORIZE_FIXTURE', ...reworked.steps.slice(9)] },
  ])
    expect(() => scenarioDefinition(invalid)).toThrow();
});
