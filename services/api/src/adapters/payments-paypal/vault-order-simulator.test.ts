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
    // As the real sandbox answered (recording sandbox-vault-release-2026-10-08T10-51-03-742Z): with a saved token,
    // creating an AUTHORIZE order authorizes at once, so the order is COMPLETED and already holds the authorization.
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ status: 'COMPLETED' });
    const authorizationId = (
      created.body as { purchase_units: { payments: { authorizations: { id: string; status: string }[] } }[] }
    ).purchase_units[0]?.payments.authorizations[0]?.id;
    expect(authorizationId).toBeTruthy();
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
    // The real sandbox refuses an unknown vault_id with 403 PERMISSION_DENIED (probe 2026-10-08).
    expect(unknown.status).toBe(403);
  } finally {
    await h.close();
  }
});

// Found on the real sandbox (2026-10-08): without usage_type MERCHANT, PayPal creates a setup token that can
// never be approved (status CREATED, no approve link). With it: PAYER_ACTION_REQUIRED and an approve link.
it('only offers buyer approval for a PayPal setup token with usage_type MERCHANT, which the SDK adapter sends', async () => {
  const h = await simulatorServer();
  try {
    const create = async (paypal: Record<string, unknown>, key: string) =>
      (await (
        await fetch(`${h.baseUrl}/v3/vault/setup-tokens`, {
          method: 'POST',
          headers: {
            Authorization: 'Bearer sim-access-token',
            'Content-Type': 'application/json',
            'PayPal-Request-Id': key,
          },
          body: JSON.stringify({ payment_source: { paypal } }),
        })
      ).json()) as { status: string; links: { rel: string }[] };
    const without = await create({ permit_multiple_payment_tokens: true }, 'no-usage');
    expect(without.status).toBe('CREATED');
    expect(without.links.map((l) => l.rel)).not.toContain('approve');
    const merchant = await create({ permit_multiple_payment_tokens: true, usage_type: 'MERCHANT' }, 'merchant');
    expect(merchant.status).toBe('PAYER_ACTION_REQUIRED');
    expect(merchant.links.map((l) => l.rel)).toContain('approve');
    const sdk = new ServerSdkTransport({
      appEnv: 'ci',
      mode: 'sim',
      baseUrl: h.baseUrl,
      clientId: 'sim-client',
      clientSecret: 'sim-secret',
      vaultReturnUrl: 'http://api:3000/paypal/return',
      vaultCancelUrl: 'http://api:3000/paypal/cancel',
    });
    const viaAdapter = await sdk.vault('CREATE_SETUP', {
      mode: 'sim',
      requestId: 'adapter-setup',
      customerRef: 'c'.repeat(64),
      setupId: null,
      tokenId: null,
      customerId: null,
    });
    expect(viaAdapter.body).toMatchObject({ status: 'PAYER_ACTION_REQUIRED' });
  } finally {
    await h.close();
  }
});
