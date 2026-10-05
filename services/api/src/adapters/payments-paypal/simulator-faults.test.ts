import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FaultController } from '../../../../simulators/src/faults.js';
import { simulatorHarness } from '../../../test/contracts/paypal-simulator.js';
import { ServerSdkTransport } from './sdk.js';

describe('Real SDK simulator fault outcomes', () => {
  it.each(['HTTP_500', 'RATE_LIMIT', 'MALFORMED'] as const)('does not capture or retry a %s response', async (kind) => {
    const faults = new FaultController([
      { method: 'POST', path: '/v2/payments/authorizations/SIM-AUTH-3/capture', kind },
    ]);
    const h = await simulatorHarness(faults);
    try {
      const response = await h.transport.call('CAPTURE', h.input);
      expect(response.status).toBe(kind === 'HTTP_500' ? 500 : kind === 'RATE_LIMIT' ? 429 : null);
      if (kind === 'MALFORMED') expect(response.body).toBeNull();
      const auth = await h.transport.call('GET_AUTHORIZATION', h.input);
      expect(auth.body).toMatchObject({ status: 'CREATED' });
    } finally {
      await h.close();
    }
  });
  it('records a completed capture even when the response is lost', async () => {
    const faults = new FaultController(
      JSON.parse(
        readFileSync(new URL('../../../../simulators/scenarios/capture-lost-response.json', import.meta.url), 'utf8'),
      ),
    );
    const h = await simulatorHarness(faults);
    try {
      expect((await h.transport.call('CAPTURE', h.input)).status).toBe(503);
      expect((await h.transport.call('GET_AUTHORIZATION', h.input)).body).toMatchObject({ status: 'CAPTURED' });
      // Only this explicit caller retry runs; the SDK never retries automatically.
      const replay = await h.transport.call('CAPTURE', h.input);
      expect(replay.status).toBe(201);
      expect(replay.body).toMatchObject({ status: 'COMPLETED' });
    } finally {
      await h.close();
    }
  });
  it('bounds a real HTTP timeout and leaves the hold unresolved', async () => {
    const faults = new FaultController(
      JSON.parse(
        readFileSync(new URL('../../../../simulators/scenarios/capture-timeout.json', import.meta.url), 'utf8'),
      ),
    );
    const h = await simulatorHarness(faults);
    try {
      const transport = new ServerSdkTransport({
        appEnv: 'ci',
        mode: 'sim',
        baseUrl: h.baseUrl,
        clientId: 'sim-client',
        clientSecret: 'sim-secret',
        timeoutMs: 50,
      });
      expect(await transport.call('CAPTURE', h.input)).toEqual({ status: null, body: null });
      expect((await h.transport.call('GET_AUTHORIZATION', h.input)).body).toMatchObject({ status: 'CREATED' });
    } finally {
      faults.release();
      await h.close();
    }
  });
});
