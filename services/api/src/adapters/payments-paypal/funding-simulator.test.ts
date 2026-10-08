import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { simulatorServer } from '../../../test/contracts/paypal-simulator.js';
import type { FundingOperation } from '../../ports/funding-store.js';
import { PayPalFundingAdapter } from './funding.js';
import { ServerSdkTransport } from './sdk.js';

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

// T-0154: a signed saved-PayPal mandate funds a later tranche with no buyer present.
it('holds money from a saved PayPal account at create, looks the token up only when calling, and refuses without one', async () => {
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
    const vault = { mode: 'sim' as const, customerRef: 'c'.repeat(64), setupId: null, tokenId: null, customerId: null };
    const setup = (await sdk.vault('CREATE_SETUP', { ...vault, requestId: 'setup-1' })).body as { id: string };
    await fetch(`${h.baseUrl}/__sim/setup-approve/${setup.id}`, {
      method: 'POST',
      headers: { Authorization: 'Bearer sim-access-token', 'Content-Type': 'application/json' },
      body: '{}',
    });
    const read = (await sdk.vault('GET_SETUP', { ...vault, requestId: 'r-1', setupId: setup.id })).body as {
      customer: { id: string };
    };
    const token = (
      await sdk.vault('CREATE_TOKEN', {
        ...vault,
        requestId: 'token-1',
        setupId: setup.id,
        customerId: read.customer.id,
      })
    ).body as { id: string };
    const asked: string[] = [];
    const tokens = {
      tokenFor: async (instruction: FundingOperation['instruction']) => {
        asked.push(instruction.allowanceId);
        return instruction.allowanceId === 'saved-allowance' ? token.id : null;
      },
    };
    const operation = (allowanceId: string): FundingOperation => ({
      key: `funding-${allowanceId}`,
      trancheId: `tranche-${allowanceId}`,
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
        key: `funding-${allowanceId}`,
        trancheId: `tranche-${allowanceId}`,
        platformId: 'fixture-buyer',
        expectedVersion: 0,
        nonce: 'K7Q',
        mode: 'sim',
        allowanceId,
        payeeRef: 'fixture-payee',
        amount: { minor: 1000, currency: 'USD' },
        source: 'SAVED_PAYPAL',
      },
    });
    const adapter = new PayPalFundingAdapter(sdk, tokens);
    const saved = operation('saved-allowance');
    const held = (await adapter.create(saved)) as { outcome: string; orderId: string; hold: { orderId: string } };
    expect(held).toMatchObject({ complete: true, outcome: 'HELD' });
    expect(held.hold.orderId).toBe(held.orderId);
    expect(JSON.stringify(held)).not.toContain(token.id);
    // A lost reply is recovered by reading the order PayPal reports, never by creating again.
    expect(await adapter.read(saved, held.orderId)).toEqual(held);
    expect(await adapter.create(operation('no-mandate'))).toEqual({ complete: false });
    expect(await new PayPalFundingAdapter(sdk).create(saved)).toEqual({ complete: false });
    expect(asked).toEqual(['saved-allowance', 'no-mandate']);
  } finally {
    await h.close();
  }
});
