import { describe, expect, it } from 'vitest';
import { simulatorServer } from '../../test/contracts/paypal-simulator.js';
import { ServerSdkTransport } from '../adapters/payments-paypal/sdk.js';
import { runSandboxScenario, runVaultSetup } from './sandbox-run.js';

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
          [`${effect}_REPLAY`, 200],
          ['GET_AUTHORIZATION', 200],
        ]);
        // Idempotency: replaying the same PayPal-Request-Id returns the same capture or hold, never a second one.
        expect(recording.steps[4]?.ids).toEqual(recording.steps[3]?.ids);
        expect(recording.steps[4]?.status).toBe(recording.steps[3]?.status);
        expect(recording.steps.at(-1)?.status).toBe(end);
        // A void reply describes the authorization, a capture reply the capture.
        const settled = recording.steps[3];
        expect(Object.keys(settled?.ids ?? {})).toEqual([effect === 'CAPTURE' ? 'capture' : 'hold']);
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

describe('Vault sandbox runs (T-0154)', () => {
  it('saves the buyer once, then holds and settles later with no approval, never recording the token', async () => {
    const h = await simulatorServer();
    try {
      const sdk = new ServerSdkTransport({
        appEnv: 'ci',
        mode: 'sim',
        baseUrl: h.baseUrl,
        clientId: 'sim-client',
        clientSecret: 'sim-secret',
        vaultReturnUrl: 'http://api:3000/paypal/return',
        vaultCancelUrl: 'http://api:3000/paypal/cancel',
      });
      const saved = await runVaultSetup({
        mode: 'sim',
        transport: sdk,
        runId: 'vault-1',
        approve: async (link) => {
          await fetch(`${h.baseUrl}/__sim/setup-approve/${link.split('/').pop()}`, {
            method: 'POST',
            headers: { Authorization: 'Bearer sim-access-token', 'Content-Type': 'application/json' },
            body: '{}',
          });
        },
        sleep: async () => {},
        maxPolls: 3,
      });
      expect(saved.recording.outcome).toBe('VAULTED');
      expect(saved.tokenId).toBeTruthy();
      expect(JSON.stringify(saved.recording)).not.toContain(saved.tokenId ?? 'missing');
      for (const [scenario, end] of [
        ['release', 'CAPTURED'],
        ['refuse', 'VOIDED'],
      ] as const) {
        const approvals: string[] = [];
        const later = await runSandboxScenario({
          scenario,
          mode: 'sim',
          transport: sdk,
          payeeRef: 'SIMMERCHANT1',
          runId: `vault-${scenario}`,
          vaultId: saved.tokenId ?? '',
          approve: async (link) => void approvals.push(link),
          sleep: async () => {},
          maxPolls: 1,
        });
        expect(approvals).toEqual([]);
        expect(later.outcome).toBe(end);
        expect(JSON.stringify(later)).not.toContain(saved.tokenId ?? 'missing');
      }
    } finally {
      await h.close();
    }
  });
});

describe('idempotent replay (T-0222)', () => {
  it('flags a replay that returns a different capture as REPLAY_MISMATCH', async () => {
    let captures = 0;
    const recording = await runSandboxScenario({
      scenario: 'release',
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
        call: async (action) =>
          action === 'CAPTURE'
            ? { status: 201, body: { id: `C${++captures}`, status: 'COMPLETED' } }
            : { status: 200, body: { id: 'A1', status: 'CAPTURED' } },
      },
    });
    expect(recording.outcome).toBe('REPLAY_MISMATCH');
  });
  it('accepts PayPal answering a replay with 200 instead of 201, when it is the same capture (seen live)', async () => {
    let calls = 0;
    const recording = await runSandboxScenario({
      scenario: 'release',
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
        call: async (action) =>
          action === 'CAPTURE'
            ? { status: ++calls === 1 ? 201 : 200, body: { id: 'C1', status: 'COMPLETED' } }
            : { status: 200, body: { id: 'A1', status: 'CAPTURED' } },
      },
    });
    expect(recording.outcome).toBe('CAPTURED');
  });
});
