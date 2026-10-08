import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { simulatorServer } from '../../test/contracts/paypal-simulator.js';
import { ServerSdkTransport } from '../adapters/payments-paypal/sdk.js';
import { runSandboxScenario, runVaultSetup, type SandboxRecording } from './sandbox-run.js';

// T-0224: every successful real PayPal sandbox recording is replayed through the simulator. The step names,
// HTTP statuses and resource states must match exactly, so the simulator cannot drift from PayPal unnoticed.
const DIR = 'services/api/test/scenarios/sandbox';
const recordings = readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => ({ file: f, recording: JSON.parse(readFileSync(join(DIR, f), 'utf8')) as SandboxRecording }))
  .filter(
    ({ recording }) => recording.mode === 'live' && ['CAPTURED', 'VOIDED', 'VAULTED'].includes(recording.outcome),
  );
const shape = (r: SandboxRecording) => r.steps.map((s) => [s.step, s.httpStatus, s.status]);

describe('Simulator matches the real PayPal sandbox recordings (T-0224)', () => {
  it('has real recordings to compare against', () => {
    expect(recordings.length).toBeGreaterThanOrEqual(5);
  });
  it.each(recordings)('$file', async ({ recording }) => {
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
      const approveAt = (path: string) => async (link: string) => {
        await fetch(`${h.baseUrl}/__sim/${path}/${link.split('/').pop()}`, {
          method: 'POST',
          headers: { Authorization: 'Bearer sim-access-token', 'Content-Type': 'application/json' },
          body: '{}',
        });
      };
      const common = { mode: 'sim' as const, transport: sdk, sleep: async () => {}, maxPolls: 3 };
      const saved = await runVaultSetup({ ...common, runId: 'drift-setup', approve: approveAt('setup-approve') });
      const vaulted = recording.runId.startsWith('sandbox-vault-');
      const replay =
        recording.scenario === 'vault-setup'
          ? saved.recording
          : await runSandboxScenario({
              ...common,
              scenario: recording.scenario,
              payeeRef: 'SIMMERCHANT1',
              runId: 'drift',
              ...(vaulted ? { vaultId: saved.tokenId ?? '' } : {}),
              // Older recordings were made before the idempotency replay step existed.
              replay: recording.steps.some((step) => step.step.endsWith('_REPLAY')),
              approve: approveAt('approve'),
            });
      expect(shape(replay)).toEqual(shape(recording));
      expect(replay.outcome).toBe(recording.outcome);
    } finally {
      await h.close();
    }
  });
});
