import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';

const config = { appEnv: 'local', paypalBaseUrl: 'https://api-m.sandbox.paypal.com', demoMode: true };
const names = ['code-good', 'signed-tests-changed', 'tests-skipped', 'weak-tests', 'usage-pending'];

describe('Code milestones are the default synthetic judge demo (T-0169)', () => {
  it('lists code fixtures first and chooses the changed-test refusal as the default', async () => {
    const response = await createApp(config).request('/v1/demo/scenarios');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ default: 'signed-tests-changed', code: names });
  });
  it.each([
    ['code-good', 'RELEASE', 'CAPTURE', null, 'Evidence checks passed.', 'The evidence checks passed.'],
    [
      'signed-tests-changed',
      'REFUSE',
      'VOID',
      'signed_tests_changed',
      'The signed tests were changed.',
      'Restore the frozen signed tests and submit a new commit.',
    ],
    [
      'tests-skipped',
      'REFUSE',
      'VOID',
      'tests_skipped',
      'Required tests were skipped.',
      'Run every frozen test without skips or selective execution.',
    ],
    [
      'weak-tests',
      'WAIT',
      'NONE',
      null,
      'The tests are too weak. A person needs to review them.',
      'Request stronger signed acceptance tests before resubmitting.',
    ],
    [
      'usage-pending',
      'WAIT',
      'NONE',
      null,
      'Usage proof is missing. The final payment waits for the buyer.',
      'Add the agreed independent usage receipt and buyer acceptance.',
    ],
  ])(
    'assesses %s as %s and names the recipient action without running code or payments',
    async (name, outcome, effect, namedField, payer, builder) => {
      const response = await createApp(config).request(`/v1/demo/scenarios/${name}`, { method: 'POST' });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toMatchObject({
        outcome,
        effect,
        namedField,
        profileId: name === 'usage-pending' ? 'code.final@1' : 'code.milestone@1',
        scenario: 'code_milestone',
        evidenceTier: 'fixture',
        source: 'synthetic_check_results',
        payment: { executed: false },
      });
      expect(body.sentences.payer).toContain(payer);
      expect(body.sentences.builder).toBe(`${builder} No payment was executed.`);
      expect(body.sentence).toContain('No payment was executed.');
      expect(body.sentences.payer).not.toBe(body.sentences.builder);
      expect(body.checks.every((c: { source: string }) => c.source === 'RULE')).toBe(true);
      expect(body.paypal).toBeUndefined();
      if (name === 'signed-tests-changed')
        expect(body.sentence).toBe('The signed tests were changed. Nothing was paid. No payment was executed.');
    },
  );
  it.each(names)('hides %s and discovery when demo mode is off', async (name) => {
    const app = createApp({ ...config, demoMode: false });
    expect((await app.request(`/v1/demo/scenarios/${name}`, { method: 'POST' })).status).toBe(404);
    expect((await app.request('/v1/demo/scenarios')).status).toBe(404);
  });
  it.each(['wrong-plot', 'good', 'recycled', 'funding-declined', 'hold-expiry'])(
    'labels %s as a site-visit scenario',
    async (name) => {
      const response = await createApp(config).request(`/v1/demo/scenarios/${name}`, { method: 'POST' });
      expect((await response.json()).scenario).toBe('site_visit');
    },
  );
});
