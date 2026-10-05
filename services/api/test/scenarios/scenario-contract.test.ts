import { readdirSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { assertScenarioEvidence, scenarioDefinition } from './scenario-contract.js';

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
