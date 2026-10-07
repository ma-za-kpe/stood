import { describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  capture: vi.fn(),
  cancel: vi.fn(),
  renew: vi.fn(),
  authorization: vi.fn(),
  order: vi.fn(),
  createOrder: vi.fn(),
  authorizeOrder: vi.fn(),
  createSetup: vi.fn(),
  getSetup: vi.fn(),
  createToken: vi.fn(),
  getToken: vi.fn(),
  client: vi.fn(),
  ApiError: class extends Error {
    statusCode = 422;
    body = '{"name":"UNPROCESSABLE_ENTITY"}';
  },
}));
vi.mock('@paypal/paypal-server-sdk', () => ({
  Client: class {
    constructor(config: unknown) {
      fake.client(config);
    }
  },
  Environment: { Sandbox: 'sandbox' },
  CheckoutPaymentIntent: { Authorize: 'AUTHORIZE' },
  ApiError: fake.ApiError,
  PaymentsController: class {
    captureAuthorizedPayment = fake.capture;
    voidPayment = fake.cancel;
    reauthorizePayment = fake.renew;
    getAuthorizedPayment = fake.authorization;
  },
  OrdersController: class {
    getOrder = fake.order;
    createOrder = fake.createOrder;
    authorizeOrder = fake.authorizeOrder;
  },
  VaultController: class {
    createSetupToken = fake.createSetup;
    getSetupToken = fake.getSetup;
    createPaymentToken = fake.createToken;
    getPaymentToken = fake.getToken;
  },
  VaultTokenRequestType: { SetupToken: 'SETUP_TOKEN' },
}));

import { type PayPalCall, ServerSdkTransport } from './sdk.js';

const config = {
  appEnv: 'ci',
  baseUrl: 'https://api-m.sandbox.paypal.com',
  clientId: 'fixture_client',
  clientSecret: 'fixture_secret',
};
const input = {
  authorizationId: 'auth_fixture',
  requestId: 'persisted_uuid',
  operationKey: 'tranche:1:CAPTURE:1',
  amount: { currencyCode: 'GBP', value: '10.00' },
};
it('uses separate persisted Vault request IDs and only server-configured callback addresses', async () => {
  const transport = new ServerSdkTransport({
    ...config,
    vaultReturnUrl: 'https://app.example.test/paypal/return',
    vaultCancelUrl: 'https://app.example.test/paypal/cancel',
  });
  const vault = {
    mode: 'live' as const,
    requestId: 'setup-request',
    customerRef: 'a'.repeat(64),
    setupId: 'SETUP',
    tokenId: 'TOKEN',
    customerId: 'CUSTOMER',
  };
  fake.createSetup.mockResolvedValue({ statusCode: 201, body: '{"id":"SETUP"}' });
  expect(await transport.vault('CREATE_SETUP', vault)).toEqual({ status: 201, body: { id: 'SETUP' } });
  expect(fake.createSetup).toHaveBeenCalledWith({
    paypalRequestId: 'setup-request',
    body: {
      customer: { merchantCustomerId: vault.customerRef },
      paymentSource: {
        paypal: {
          permitMultiplePaymentTokens: true,
          experienceContext: {
            returnUrl: 'https://app.example.test/paypal/return',
            cancelUrl: 'https://app.example.test/paypal/cancel',
          },
        },
      },
    },
  });
  fake.createToken.mockResolvedValue({ statusCode: 201, body: '{"id":"TOKEN"}' });
  await transport.vault('CREATE_TOKEN', { ...vault, requestId: 'token-request' });
  expect(fake.createToken).toHaveBeenCalledWith({
    paypalRequestId: 'token-request',
    body: {
      customer: { id: 'CUSTOMER', merchantCustomerId: vault.customerRef },
      paymentSource: { token: { id: 'SETUP', type: 'SETUP_TOKEN' } },
    },
  });
  fake.getSetup.mockResolvedValue({ statusCode: 200, body: '{"id":"SETUP"}' });
  fake.getToken.mockResolvedValue({ statusCode: 200, body: '{"id":"TOKEN"}' });
  await transport.vault('GET_SETUP', vault);
  await transport.vault('GET_TOKEN', vault);
  expect(fake.getSetup).toHaveBeenCalledWith('SETUP');
  expect(fake.getToken).toHaveBeenCalledWith('TOKEN');
  fake.createToken.mockRejectedValue(new Error('fixture_secret'));
  expect(await transport.vault('CREATE_TOKEN', vault)).toEqual({ status: null, body: null });
  fake.createToken.mockRejectedValue(new fake.ApiError());
  expect((await transport.vault('CREATE_TOKEN', vault)).status).toBe(422);
  expect(await transport.vault('CREATE_SETUP', { ...vault, mode: 'sim' })).toEqual({ status: null, body: null });
  expect(fake.createSetup).toHaveBeenCalledTimes(1);
});
it('refuses unsafe or absent Vault callbacks before a setup request', async () => {
  const vault = {
    mode: 'live' as const,
    requestId: 'setup-request',
    customerRef: 'a'.repeat(64),
    setupId: null,
    tokenId: null,
    customerId: null,
  };
  expect(await new ServerSdkTransport(config).vault('CREATE_SETUP', vault)).toEqual({ status: null, body: null });
  for (const url of [
    'http://app.example.test/return',
    'https://u:p@app.example.test/return',
    'https://app.example.test/return#fragment',
    'not a url',
  ]) {
    expect(
      () =>
        new ServerSdkTransport({ ...config, vaultReturnUrl: url, vaultCancelUrl: 'https://app.example.test/cancel' }),
    ).toThrow('Vault callbacks not configured');
  }
});
it('sends separate persisted IDs for order creation and authorisation through the pinned SDK', async () => {
  const transport = new ServerSdkTransport(config);
  const funding = {
    mode: 'live' as const,
    orderId: 'ORDER',
    requestId: 'create-id',
    operationKey: 'funding',
    trancheId: 'tranche',
    payeeRef: 'sandbox-payee',
    amount: input.amount,
  };
  fake.createOrder.mockResolvedValue({ statusCode: 201, body: '{"id":"ORDER"}' });
  expect(await transport.fund('CREATE_ORDER', funding)).toEqual({ status: 201, body: { id: 'ORDER' } });
  expect(fake.createOrder).toHaveBeenCalledWith(
    expect.objectContaining({
      paypalRequestId: 'create-id',
      body: {
        intent: 'AUTHORIZE',
        purchaseUnits: [
          { referenceId: 'funding', customId: 'tranche', payee: { merchantId: 'sandbox-payee' }, amount: input.amount },
        ],
      },
    }),
  );
  expect(await transport.fund('CREATE_ORDER', { ...funding, mode: 'sim' })).toEqual({ status: null, body: null });
  expect(fake.createOrder).toHaveBeenCalledTimes(1);
  fake.authorizeOrder.mockResolvedValue({ statusCode: 201, body: '{"id":"ORDER"}' });
  await transport.fund('AUTHORIZE_ORDER', { ...funding, requestId: 'authorize-id' });
  expect(fake.authorizeOrder).toHaveBeenCalledWith({
    id: 'ORDER',
    paypalRequestId: 'authorize-id',
    prefer: 'return=representation',
    body: {},
  });
  fake.order.mockResolvedValue({ statusCode: 200, body: '{"id":"ORDER"}' });
  await transport.fund('GET_FUNDING_ORDER', funding);
  expect(fake.order).toHaveBeenCalledWith({ id: 'ORDER' });
  fake.authorizeOrder.mockRejectedValue(new Error('secret'));
  expect(await transport.fund('AUTHORIZE_ORDER', funding)).toEqual({ status: null, body: null });
});
describe('Sandbox Server SDK transport', () => {
  it.each(['CAPTURE', 'VOID', 'REAUTHORIZE', 'GET_AUTHORIZATION', 'GET_ORDER'] as PayPalCall[])(
    'maps %s to the correct SDK controller with stable identifiers',
    async (action) => {
      for (const fn of [fake.capture, fake.cancel, fake.renew, fake.authorization, fake.order])
        fn.mockReset().mockResolvedValue({ statusCode: 200, body: '{"id":"fixture"}' });
      expect(await new ServerSdkTransport(config).call(action, input)).toEqual({
        status: 200,
        body: { id: 'fixture' },
      });
      if (action === 'CAPTURE')
        expect(fake.capture).toHaveBeenCalledWith(
          expect.objectContaining({
            paypalRequestId: 'persisted_uuid',
            body: { amount: input.amount, finalCapture: true, invoiceId: input.operationKey },
          }),
        );
    },
  );
  it('uses only sandbox and disables retries and SDK credential/body logging', () => {
    new ServerSdkTransport(config);
    expect(fake.client).toHaveBeenLastCalledWith(
      expect.objectContaining({
        environment: 'sandbox',
        timeout: 10000,
        httpClientOptions: { retryConfig: { maxNumberOfRetries: 0 } },
      }),
    );
    for (const patch of [
      { appEnv: 'live' },
      { baseUrl: 'https://api-m.paypal.com' },
      { clientId: '' },
      { clientSecret: '' },
    ])
      expect(() => new ServerSdkTransport({ ...config, ...patch })).toThrow('Sandbox payments not configured');
  });
  it('returns opaque failures safely and refuses malformed/non-string bodies', async () => {
    const transport = new ServerSdkTransport(config);
    fake.capture.mockRejectedValue(new fake.ApiError());
    expect((await transport.call('CAPTURE', input)).status).toBe(422);
    fake.capture.mockRejectedValue(new Error('fixture_secret'));
    expect(await transport.call('CAPTURE', input)).toEqual({ status: null, body: null });
    for (const body of ['bad JSON', null]) {
      fake.capture.mockResolvedValue({ statusCode: 201, body });
      expect((await transport.call('CAPTURE', input)).body).toBeNull();
    }
  });
});
