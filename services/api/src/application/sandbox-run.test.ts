import { describe, expect, it } from 'vitest';
import { simulatorServer } from '../../test/contracts/paypal-simulator.js';
import { ServerSdkTransport } from '../adapters/payments-paypal/sdk.js';
import { runSandboxScenario } from './sandbox-run.js';

// T-0224: one scripted hold → release or refuse run through Stood's own SDK adapter, recorded without personal data.
describe('Sandbox scenario run (T-0224)', () => {
  it.each([
    ['release', 'CAPTURE', 'CAPTURED'],
    ['refuse', 'VOID', 'VOIDED'],
  ] as const)(
    '%s: holds, waits for buyer approval, settles once and records the exchange',
    async (scenario, effect, end) => {
      const h = await simulatorServer();
      try {
        const sdk = new ServerSdkTransport({
          appEnv: 'ci',
          mode: 'sim',
          baseUrl: h.baseUrl,
          clientId: 'sim-client',
          clientSecret: 'sim-secret',
        });
        const links: string[] = [];
        const recording = await runSandboxScenario({
          scenario,
          mode: 'sim',
          transport: sdk,
          payeeRef: 'SIMMERCHANT1',
          runId: 'run-1',
          // The buyer approves in a browser; here the simulator's approval endpoint stands in.
          approve: async (link) => {
            links.push(link);
            const id = link.split('/').pop();
            await fetch(`${h.baseUrl}/__sim/approve/${id}`, {
              method: 'POST',
              headers: { Authorization: 'Bearer sim-access-token', 'Content-Type': 'application/json' },
              body: '{}',
            });
          },
          sleep: async () => {},
          maxPolls: 3,
        });
        expect(links).toHaveLength(1);
        expect(recording.scenario).toBe(scenario);
        expect(recording.steps.map((s) => [s.step, s.httpStatus])).toEqual([
          ['CREATE_ORDER', 201],
          ['GET_FUNDING_ORDER', 200],
          ['AUTHORIZE_ORDER', 201],
          [effect, effect === 'CAPTURE' ? 201 : 200],
          ['GET_AUTHORIZATION', 200],
        ]);
        expect(recording.steps.at(-1)?.status).toBe(end);
        // A void reply describes the authorization, a capture reply the capture.
        const settled = recording.steps[3];
        expect(Object.keys(settled?.ids ?? {})).toEqual([effect === 'CAPTURE' ? 'capture' : 'authorization']);
        expect(recording.outcome).toBe(end);
        // Sanitised: ids, statuses and amounts only; no payer, links or names.
        const text = JSON.stringify(recording);
        for (const banned of ['payer', 'email', 'given_name', 'href', 'sim-access-token'])
          expect(text).not.toContain(banned);
      } finally {
        await h.close();
      }
    },
  );

  it('stops without settling when the buyer never approves', async () => {
    const h = await simulatorServer();
    try {
      const sdk = new ServerSdkTransport({
        appEnv: 'ci',
        mode: 'sim',
        baseUrl: h.baseUrl,
        clientId: 'sim-client',
        clientSecret: 'sim-secret',
      });
      const recording = await runSandboxScenario({
        scenario: 'release',
        mode: 'sim',
        transport: sdk,
        payeeRef: 'SIMMERCHANT1',
        runId: 'run-2',
        approve: async () => {},
        sleep: async () => {},
        maxPolls: 2,
      });
      expect(recording.outcome).toBe('NOT_APPROVED');
      expect(recording.steps.map((s) => s.step)).not.toContain('CAPTURE');
    } finally {
      await h.close();
    }
  });
});

describe('recording a PayPal refusal', () => {
  it('keeps the error name, issue and debug id so a failed step can be diagnosed', async () => {
    const refusal = {
      status: 403,
      body: { name: 'NOT_AUTHORIZED', details: [{ issue: 'PERMISSION_DENIED' }], debug_id: 'dbg-403' },
    };
    const recording = await runSandboxScenario({
      scenario: 'refuse',
      mode: 'sim',
      payeeRef: 'X',
      runId: 'r',
      approve: async () => {},
      sleep: async () => {},
      maxPolls: 1,
      transport: {
        fund: async (action) =>
          action === 'CREATE_ORDER'
            ? { status: 201, body: { id: 'O1', status: 'CREATED', links: [{ rel: 'approve', href: 'https://x/O1' }] } }
            : action === 'GET_FUNDING_ORDER'
              ? { status: 200, body: { id: 'O1', status: 'APPROVED' } }
              : { status: 201, body: { id: 'O1', purchase_units: [{ payments: { authorizations: [{ id: 'A1' }] } }] } },
        call: async (action) => (action === 'VOID' ? refusal : { status: 200, body: { id: 'A1', status: 'CREATED' } }),
      },
    });
    expect(recording.steps[3]).toMatchObject({
      step: 'VOID',
      httpStatus: 403,
      issue: 'NOT_AUTHORIZED: PERMISSION_DENIED',
      debugId: 'dbg-403',
    });
    expect(recording.outcome).toBe('CREATED');
  });
});
