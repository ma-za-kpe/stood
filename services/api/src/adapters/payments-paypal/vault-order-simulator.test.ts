import { expect, it } from 'vitest';
import { simulatorServer } from '../../../test/contracts/paypal-simulator.js';
import { ServerSdkTransport } from './sdk.js';

// T-0154: a saved PayPal payment token pays a later hold with no buyer present (merchant-initiated).
it('places and captures a later hold from a saved payment token without buyer approval, and refuses unknown tokens', async () => {
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
    // The buyer approves saving PayPal once; the simulator's endpoint stands in for the browser.
    await fetch(`${h.baseUrl}/__sim/setup-approve/${setup.id}`, {
      method: 'POST',
      headers: { Authorization: 'Bearer sim-access-token', 'Content-Type': 'application/json' },
      body: '{}',
    });
    // As the real adapter does: read the approved setup token for PayPal's customer id, then save the token.
    const approved = (await sdk.vault('GET_SETUP', { ...vault, requestId: 'read-1', setupId: setup.id })).body as {
      customer: { id: string };
    };
    const token = (
      await sdk.vault('CREATE_TOKEN', {
        ...vault,
        requestId: 'token-1',
        setupId: setup.id,
        customerId: approved.customer.id,
      })
    ).body as { id: string };
    const order = {
      mode: 'sim' as const,
      operationKey: 'later-hold',
      trancheId: 'tranche-later',
      payeeRef: 'SIMMERCHANT1',
      amount: { currencyCode: 'USD', value: '10.00' },
    };
    const created = await sdk.fund('CREATE_ORDER', {
      ...order,
      orderId: null,
      requestId: 'order-1',
      vaultId: token.id,
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ status: 'APPROVED' });
    const orderId = (created.body as { id: string }).id;
    const authorized = await sdk.fund('AUTHORIZE_ORDER', { ...order, orderId, requestId: 'auth-1', vaultId: token.id });
    expect(authorized.status).toBe(201);
    const authorizationId = (
      authorized.body as { purchase_units: { payments: { authorizations: { id: string }[] } }[] }
    ).purchase_units[0]?.payments.authorizations[0]?.id;
    const captured = await sdk.call('CAPTURE', {
      authorizationId: authorizationId ?? '',
      requestId: 'cap-1',
      operationKey: 'later-settle',
      amount: order.amount,
    });
    expect(captured).toMatchObject({ status: 201, body: { status: 'COMPLETED' } });
    const unknown = await sdk.fund('CREATE_ORDER', {
      ...order,
      orderId: null,
      requestId: 'order-2',
      vaultId: 'NO-SUCH-TOKEN',
    });
    expect(unknown.status).toBe(422);
  } finally {
    await h.close();
  }
});
