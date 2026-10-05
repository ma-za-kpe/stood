import { readdirSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { runScenario, type ScenarioEvidence, scenarioDefinition } from '../scenarios/scenario-contract.js';

const scenarios = readdirSync('services/api/test/scenarios/stood')
  .filter((f) => f.endsWith('.json'))
  .map((f) => scenarioDefinition(JSON.parse(readFileSync(`services/api/test/scenarios/stood/${f}`, 'utf8'))));
const request = async (path: string, value?: unknown) => {
  const response = await fetch(`http://api:3000${path}`, {
    method: value === undefined ? 'GET' : 'POST',
    headers: { Authorization: 'Bearer sim-control-key', 'Content-Type': 'application/json' },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
    signal: AbortSignal.timeout(10000),
  });
  expect(response.ok, `${path}: HTTP ${response.status}`).toBe(true);
  return response.json();
};
it.each(scenarios)('network Stood: $id (external services, synthetic setup)', async (scenario) => {
  await request(`/__mock/sessions/${scenario.id}`, {});
  await runScenario(scenario, {
    step: async (step) => {
      await request(`/__mock/sessions/${scenario.id}/steps`, { step });
    },
    observe: async () => (await request(`/__mock/sessions/${scenario.id}/evidence`)) as ScenarioEvidence,
  });
  expect(await request('/health')).toMatchObject({
    paymentReady: false,
    clock: { mode: 'controlled' },
    providers: [{ provider: 'paypal', mode: 'sim', simulated: true, ready: true }],
  });
});
