import { expect, it } from 'vitest';
import { FaultController } from '../../../../simulators/src/faults.js';
import { simulatorServer } from '../../../test/contracts/paypal-simulator.js';
import { ServerSdkTransport } from './sdk.js';

// T-0155: the reconciliation audit reads PayPal Transaction Search through the pinned Server SDK
// (TransactionSearchController, called as the APIMatic Context Plugin documents), page by page.
it('reads every capture across pages through the Server SDK, and refuses windows PayPal would reject', async () => {
  const h = await simulatorServer();
  try {
    const sdk = new ServerSdkTransport({
      appEnv: 'ci',
      mode: 'sim',
      baseUrl: h.baseUrl,
      clientId: 'sim-client',
      clientSecret: 'sim-secret',
      searchPageSize: 2,
    });
    for (const n of [1, 2, 3]) {
      const input = await h.seed(`tranche-${n}`);
      const capture = await sdk.call('CAPTURE', { ...input, requestId: `cap-${n}`, operationKey: `op-${n}` });
      expect(capture.status).toBe(201);
    }
    const from = Date.parse('2026-10-04T00:00:00Z');
    const captures = await sdk.captures(from, from + 2 * 86400000);
    expect(captures).toHaveLength(3);
    expect(captures.map((c) => c.invoiceId).sort()).toEqual(['op-1', 'op-2', 'op-3']);
    expect(captures[0]).toMatchObject({ minor: 1000, currency: 'USD', status: 'COMPLETED' });
    // PayPal searches at most 31 days at a time; a longer or inverted window is refused before any call.
    await expect(sdk.captures(from, from + 32 * 86400000)).rejects.toThrow(RangeError);
    await expect(sdk.captures(from, from - 1)).rejects.toThrow(RangeError);
  } finally {
    await h.close();
  }
});

it("reports a Transaction Search outage with PayPal's debug id, and rejects an invalid page size", async () => {
  const faults = new FaultController([{ method: 'GET', path: '/v1/reporting/transactions', kind: 'HTTP_500' }]);
  const h = await simulatorServer(faults);
  try {
    const from = Date.parse('2026-10-04T00:00:00Z');
    await expect(h.transport.captures(from, from + 86400000)).rejects.toThrow(
      /Transaction search unavailable \(HTTP 500, debug id /,
    );
    const base = { appEnv: 'ci', mode: 'sim', baseUrl: h.baseUrl, clientId: 'sim-client', clientSecret: 'sim-secret' };
    for (const searchPageSize of [0, 501, 1.5])
      expect(() => new ServerSdkTransport({ ...base, searchPageSize })).toThrow('page size');
  } finally {
    await h.close();
  }
});
