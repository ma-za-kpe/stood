import { describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  capture: vi.fn(),
  cancel: vi.fn(),
  renew: vi.fn(),
  authorization: vi.fn(),
  order: vi.fn(),
  createOrder: vi.fn(),
  authorizeOrder: vi.fn(),
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
