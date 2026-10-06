import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { simulatorServer } from '../../../test/contracts/paypal-simulator.js';
import type { FundingOperation } from '../../ports/funding-store.js';
import { PayPalFundingAdapter } from './funding.js';

it('runs create, buyer approval, authorize and read through the actual SDK and local HTTP simulator', async () => {
  const h = await simulatorServer();
  try {
    const adapter = new PayPalFundingAdapter(h.transport);
    const operation: FundingOperation = {
      key: 'funding-http',
      trancheId: 'tranche-http',
      version: 1,
      status: 'CREATING',
      createRequestId: randomUUID(),
      authorizeRequestId: randomUUID(),
      orderId: null,
      approvalUrl: null,
      hold: null,
      reference: null,
      createdAt: '2026-10-05T00:00:00Z',
      instruction: {
        key: 'funding-http',
        trancheId: 'tranche-http',
        platformId: 'fixture-buyer',
        expectedVersion: 0,
        nonce: 'K7Q',
        mode: 'sim',
        allowanceId: 'fixture-allowance',
        payeeRef: 'fixture-payee',
        amount: { minor: 1000, currency: 'USD' },
      },
    };
    const created = (await adapter.create(operation)) as { complete: boolean; orderId: string; approvalUrl: string };
    expect(created.complete).toBe(true);
    const awaiting: FundingOperation = {
      ...operation,
      status: 'AWAITING_APPROVAL',
      orderId: created.orderId,
      approvalUrl: created.approvalUrl,
    };
    expect(await adapter.read(awaiting)).toMatchObject({ complete: true, outcome: 'CREATED' });
    const approved = await fetch(`${h.baseUrl}/__sim/approve/${created.orderId}`, {
      method: 'POST',
      headers: { Authorization: 'Bearer sim-access-token', 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(approved.ok).toBe(true);
    expect(await adapter.read(awaiting)).toMatchObject({ complete: true, outcome: 'APPROVED' });
    const authorizing: FundingOperation = { ...awaiting, status: 'AUTHORIZING' };
    const hold = await adapter.authorize(authorizing);
    expect(hold).toMatchObject({
      complete: true,
      outcome: 'HELD',
      hold: { orderId: created.orderId, heldAt: Date.parse('2026-10-05T00:00:00Z') },
    });
    expect(await adapter.read(authorizing)).toEqual(hold);
  } finally {
    await h.close();
  }
});
