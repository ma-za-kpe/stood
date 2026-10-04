import { describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  capture: vi.fn(),
  cancel: vi.fn(),
  renew: vi.fn(),
  authorization: vi.fn(),
  order: vi.fn(),
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
  ApiError: fake.ApiError,
  PaymentsController: class {
    captureAuthorizedPayment = fake.capture;
    voidPayment = fake.cancel;
    reauthorizePayment = fake.renew;
    getAuthorizedPayment = fake.authorization;
  },
  OrdersController: class {
    getOrder = fake.order;
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
