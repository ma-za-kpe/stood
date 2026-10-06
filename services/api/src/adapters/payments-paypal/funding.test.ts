import { expect, it, vi } from 'vitest';
import type { FundingOperation } from '../../ports/funding-store.js';
import { PayPalFundingAdapter } from './funding.js';

const operation: FundingOperation = {
  key: 'funding',
  trancheId: 'tranche',
  version: 3,
  status: 'AUTHORIZING',
  createRequestId: 'create-id',
  authorizeRequestId: 'authorize-id',
  orderId: 'ORDER',
  approvalUrl: 'http://paypal-sim:8080/__sim/approve/ORDER',
  hold: null,
  reference: null,
  createdAt: '2026-10-06T00:00:00Z',
  instruction: {
    key: 'funding',
    trancheId: 'tranche',
    platformId: 'buyer',
    expectedVersion: 0,
    nonce: 'K7Q',
    mode: 'sim',
    allowanceId: 'allowance',
    payeeRef: 'sandbox-payee',
    amount: { minor: 1000, currency: 'USD' },
  },
};
const order = () => ({
  id: 'ORDER',
  intent: 'AUTHORIZE',
  status: 'COMPLETED',
  purchase_units: [
    {
      reference_id: 'funding',
      custom_id: 'tranche',
      payee: { merchant_id: 'sandbox-payee' },
      amount: { currency_code: 'USD', value: '10.00' },
      payments: {
        captures: [],
        authorizations: [
          {
            id: 'AUTH',
            status: 'CREATED',
            amount: { currency_code: 'USD', value: '10.00' },
            create_time: '2026-10-06T00:00:00Z',
            expiration_time: '2026-11-04T00:00:00Z',
            supplementary_data: { related_ids: { order_id: 'ORDER' } },
          },
        ],
      },
    },
  ],
  links: [{ rel: 'approve', href: 'http://paypal-sim:8080/__sim/approve/ORDER' }],
});
it('matches order, tranche, operation, payee, amount and one uncaptured authorisation', async () => {
  const transport = { fund: vi.fn(async () => ({ status: 201, body: order() })) };
  const adapter = new PayPalFundingAdapter(transport);
  expect(await adapter.authorize(operation)).toMatchObject({
    complete: true,
    key: 'funding',
    orderId: 'ORDER',
    outcome: 'HELD',
    hold: { authorizationId: 'AUTH', heldAt: Date.parse('2026-10-06T00:00:00Z') },
  });
  expect(transport.fund).toHaveBeenCalledWith(
    'AUTHORIZE_ORDER',
    expect.objectContaining({ requestId: 'authorize-id', orderId: 'ORDER' }),
  );
});
it('creates only from a durable CREATING phase and never invents an approval link or confirmation', async () => {
  const body = {
    ...order(),
    status: 'CREATED',
    purchase_units: order().purchase_units.map((u) => ({ ...u, payments: { captures: [], authorizations: [] } })),
  };
  const transport = { fund: vi.fn(async () => ({ status: 201, body })) };
  const adapter = new PayPalFundingAdapter(transport);
  expect(await adapter.create({ ...operation, status: 'CREATING', orderId: null, approvalUrl: null })).toMatchObject({
    outcome: 'CREATED',
    complete: true,
  });
  expect(transport.fund).toHaveBeenCalledWith(
    'CREATE_ORDER',
    expect.objectContaining({
      requestId: 'create-id',
      payeeRef: 'sandbox-payee',
      amount: { currencyCode: 'USD', value: '10.00' },
    }),
  );
  expect(await adapter.create(operation)).toEqual({ complete: false });
  expect(transport.fund).toHaveBeenCalledTimes(1);
});
it.each([
  { id: 'foreign' },
  { intent: 'CAPTURE' },
  { status: 'PENDING' },
  { purchase_units: order().purchase_units.map((u) => ({ ...u, custom_id: 'foreign' })) },
  { purchase_units: order().purchase_units.map((u) => ({ ...u, reference_id: 'foreign' })) },
  { purchase_units: order().purchase_units.map((u) => ({ ...u, payee: { merchant_id: 'foreign' } })) },
  { purchase_units: order().purchase_units.map((u) => ({ ...u, amount: { currency_code: 'USD', value: '11.00' } })) },
  {
    purchase_units: order().purchase_units.map((u) => ({
      ...u,
      payments: { ...u.payments, captures: [{ id: 'CAPTURE' }] },
    })),
  },
  { purchase_units: order().purchase_units.map((u) => ({ ...u, payments: { captures: [], authorizations: [] } })) },
])('keeps incomplete, contradictory or foreign funding responses unresolved: %j', async (patch) => {
  const adapter = new PayPalFundingAdapter({ fund: async () => ({ status: 201, body: { ...order(), ...patch } }) });
  expect(await adapter.authorize(operation)).toEqual({ complete: false });
});
it('uses read-only lookup for unresolved funding and refuses unsafe candidate order identities', async () => {
  const transport = { fund: vi.fn(async () => ({ status: 200, body: order() })) };
  const adapter = new PayPalFundingAdapter(transport);
  expect(await adapter.read(operation)).toMatchObject({ outcome: 'HELD' });
  expect(transport.fund).toHaveBeenCalledWith('GET_FUNDING_ORDER', expect.objectContaining({ orderId: 'ORDER' }));
  expect(await adapter.read({ ...operation, status: 'CREATING', orderId: null }, '../foreign')).toEqual({
    complete: false,
  });
  expect(transport.fund).toHaveBeenCalledTimes(1);
});
it('reports provider-confirmed expiry only with the exact uncaptured hold history', async () => {
  const body = order();
  body.purchase_units[0]!.payments.authorizations[0]!.status = 'EXPIRED';
  const adapter = new PayPalFundingAdapter({ fund: async () => ({ status: 200, body }) });
  expect(await adapter.read(operation)).toMatchObject({
    complete: true,
    outcome: 'EXPIRED',
    hold: { authorizationId: 'AUTH' },
  });
  expect(await adapter.authorize(operation)).toEqual({ complete: false });
});
it('only classifies a consistent well-formed instrument decline on authorisation as definite', async () => {
  const body = {
    name: 'UNPROCESSABLE_ENTITY',
    message: 'Declined',
    debug_id: 'debug',
    details: [{ issue: 'INSTRUMENT_DECLINED' }],
  };
  const adapter = new PayPalFundingAdapter({ fund: async () => ({ status: 422, body }) });
  expect(await adapter.authorize(operation)).toMatchObject({ outcome: 'DECLINED', reference: 'debug' });
  for (const response of [
    { status: 500, body },
    { status: 422, body: { ...body, details: [{ issue: 'INSTRUMENT_DECLINED' }, { issue: 'UNKNOWN' }] } },
    { status: null, body: null },
  ])
    expect(await new PayPalFundingAdapter({ fund: async () => response }).authorize(operation)).toEqual({
      complete: false,
    });
});
