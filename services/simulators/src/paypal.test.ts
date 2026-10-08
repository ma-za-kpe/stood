import { describe, expect, it } from 'vitest';
import { FaultController } from './faults.js';
import { createPayPalSimulator } from './paypal.js';

const headers = {
  Authorization: 'Bearer sim-access-token',
  'Content-Type': 'application/json',
  'PayPal-Request-Id': 'fixture-request',
};
describe('PayPal HTTP simulator protocol', () => {
  it('preserves Vault customer correlation and requires the approved customer when creating a token', async () => {
    const sim = createPayPalSimulator({ environment: 'ci', clock: () => 0 });
    const setup = await (
      await sim.app.request('/v3/vault/setup-tokens', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          customer: { merchant_customer_id: 'signed-terms-reference' },
          payment_source: { paypal: { usage_type: 'MERCHANT' } },
        }),
      })
    ).json();
    expect(setup.customer).toMatchObject({ merchant_customer_id: 'signed-terms-reference' });
    expect(setup.customer.id).toMatch(/^SIM/);
    sim.approveSetup(setup.id);
    const approved = await (await sim.app.request(`/v3/vault/setup-tokens/${setup.id}`, { headers })).json();
    expect(approved.payment_source.paypal.payer_id).toMatch(/^SIM/);
    const create = (customer: unknown, key: string) =>
      sim.app.request('/v3/vault/payment-tokens', {
        method: 'POST',
        headers: { ...headers, 'PayPal-Request-Id': key },
        body: JSON.stringify({
          customer,
          payment_source: { token: { id: setup.id, type: 'SETUP_TOKEN' } },
        }),
      });
    expect((await create({ id: 'another', merchant_customer_id: 'signed-terms-reference' }, 'wrong')).status).toBe(422);
    const token = await (await create(setup.customer, 'right')).json();
    expect(token.customer).toEqual(setup.customer);
    expect(token.payment_source.paypal.payer_id).toBe(approved.payment_source.paypal.payer_id);
    expect((await create(setup.customer, 'another-token')).status).toBe(422);
  });
  it('expires Vault request-ID replay after three hours rather than promising unlimited idempotency', async () => {
    let time = 0;
    const sim = createPayPalSimulator({ environment: 'ci', clock: () => time });
    const create = () =>
      sim.app.request('/v3/vault/setup-tokens', {
        method: 'POST',
        headers,
        body: JSON.stringify({ payment_source: { paypal: { usage_type: 'MERCHANT' } } }),
      });
    const first = await (await create()).json();
    time = 3 * 3600000 - 1;
    expect(await (await create()).json()).toEqual(first);
    time += 1;
    expect((await (await create()).json()).id).not.toBe(first.id);
  });
  it('preserves the explicit funding operation and merchant identity through create, approval and authorization', async () => {
    const sim = createPayPalSimulator({ environment: 'ci', clock: () => Date.parse('2026-10-06T00:00:00Z') });
    const response = await sim.app.request('/v2/checkout/orders', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        intent: 'AUTHORIZE',
        purchase_units: [
          {
            reference_id: 'funding',
            custom_id: 'tranche',
            payee: { merchant_id: 'sim-payee' },
            amount: { currency_code: 'USD', value: '10.00' },
          },
        ],
      }),
    });
    const created = await response.json();
    expect(created.purchase_units[0]).toMatchObject({ reference_id: 'funding', payee: { merchant_id: 'sim-payee' } });
    sim.approve(created.id);
    const authorized = await (
      await sim.app.request(`/v2/checkout/orders/${created.id}/authorize`, {
        method: 'POST',
        headers: { ...headers, 'PayPal-Request-Id': 'authorize-funding' },
        body: '{}',
      })
    ).json();
    expect(authorized.purchase_units[0]).toMatchObject({
      reference_id: 'funding',
      payee: { merchant_id: 'sim-payee' },
    });
    expect(authorized.purchase_units[0].payments.authorizations).toHaveLength(1);
  });
  it('injects token faults only for the fixed synthetic client without issuing an access token', async () => {
    const faults = new FaultController([{ method: 'POST', path: '/v1/oauth2/token', kind: 'HTTP_500' }]);
    const { app } = createPayPalSimulator({ environment: 'ci', clock: () => 0, faults });
    const token = (authorization: string) =>
      app.request('/v1/oauth2/token', {
        method: 'POST',
        headers: { Authorization: authorization },
        body: 'grant_type=client_credentials',
      });
    expect((await token('Basic invalid')).status).toBe(401);
    expect((await token('Bearer sim-access-token')).status).toBe(401);
    const credential = `Basic ${Buffer.from('sim-client:sim-secret').toString('base64')}`;
    const failed = await token(credential);
    expect(failed.status).toBe(500);
    expect(await failed.json()).not.toHaveProperty('access_token');
    expect((await token(credential)).status).toBe(200);
  });
  it('allows omitted renewal amount but never renews a renewed hold or the original twice', async () => {
    let now = 0;
    const sim = createPayPalSimulator({ environment: 'ci', clock: () => now });
    let key = 0;
    const post = (path: string, body: unknown) =>
      sim.app.request(path, {
        method: 'POST',
        headers: { ...headers, 'PayPal-Request-Id': `renewal-${++key}` },
        body: JSON.stringify(body),
      });
    const order = await (
      await post('/v2/checkout/orders', {
        intent: 'AUTHORIZE',
        purchase_units: [{ custom_id: 'renewal', amount: { currency_code: 'USD', value: '10.00' } }],
      })
    ).json();
    sim.approve(order.id);
    const authorized = await (await post(`/v2/checkout/orders/${order.id}/authorize`, {})).json();
    const original = authorized.purchase_units[0].payments.authorizations[0].id;
    now = 4 * 86400000;
    const response = await post(`/v2/payments/authorizations/${original}/reauthorize`, {});
    expect(response.status).toBe(201);
    const renewed = await response.json();
    expect(renewed.amount).toEqual({ currency_code: 'USD', value: '10.00' });
    now = 8 * 86400000;
    for (const auth of [original, renewed.id]) {
      expect((await post(`/v2/payments/authorizations/${auth}/reauthorize`, {})).status).toBe(422);
    }
    const stored = await (await sim.app.request(`/v2/checkout/orders/${order.id}`, { headers })).json();
    expect(stored.purchase_units[0].payments.authorizations).toHaveLength(2);
  });
  it('rejects malformed commands, unsupported money and unknown resources', async () => {
    const { app } = createPayPalSimulator({ environment: 'ci', clock: () => 0 });
    let key = 0;
    const post = (path: string, body: string, requestId = `invalid-${++key}`) =>
      app.request(path, { method: 'POST', headers: { ...headers, 'PayPal-Request-Id': requestId }, body });
    expect((await post('/v2/checkout/orders', '{')).status).toBe(400);
    expect((await post('/v2/checkout/orders', 'x'.repeat(65537))).status).toBe(413);
    expect((await post('/v2/checkout/orders', '{}', '')).status).toBe(400);
    for (const money of [
      {},
      { currency_code: 'CAD', value: '1.00' },
      { currency_code: 'USD', value: '0.00' },
      { currency_code: 'USD', value: 1 },
      { currency_code: 'USD', value: '01.00' },
    ])
      expect(
        (
          await post(
            '/v2/checkout/orders',
            JSON.stringify({ intent: 'AUTHORIZE', purchase_units: [{ custom_id: 'tranche', amount: money }] }),
          )
        ).status,
      ).toBe(422);
    for (const body of ['null', '[]', '{"intent":"CAPTURE"}', '{"purchase_units":[]}'])
      expect((await post('/v2/checkout/orders', body)).status).toBe(422);
    for (const path of [
      '/missing',
      '/v2/checkout/orders/missing',
      '/v2/payments/authorizations/missing',
      '/v2/payments/captures/missing',
      '/v3/vault/setup-tokens/missing',
      '/v3/vault/payment-tokens/missing',
    ])
      expect((await app.request(path, { headers })).status).toBe(404);
    for (const path of [
      '/missing',
      '/v2/checkout/orders/missing/authorize',
      '/v2/payments/authorizations/missing/capture',
    ])
      expect((await post(path, '{}')).status).toBe(404);
    expect((await app.request('/missing', { method: 'PUT', headers })).status).toBe(405);
    expect((await app.request('/v3/vault/payment-tokens/missing', { method: 'DELETE', headers })).status).toBe(404);
    expect((await post('/__sim/approve/missing', '{}')).status).toBe(422);
    expect((await post('/__sim/setup-approve/missing', '{}')).status).toBe(422);
    expect((await post('/__sim/advance', '{"milliseconds":-1}')).status).toBe(400);
    expect(await (await post('/__sim/advance', '{"milliseconds":86400000}')).json()).toMatchObject({
      simulated: true,
      now: 86400000,
    });
  });
  it('keeps invalid capture and renewal requests from changing the hold', async () => {
    let now = 0;
    const sim = createPayPalSimulator({ environment: 'ci', clock: () => now });
    let key = 0;
    const post = (path: string, body: unknown) =>
      sim.app.request(path, {
        method: 'POST',
        headers: { ...headers, 'PayPal-Request-Id': `hold-${++key}` },
        body: JSON.stringify(body),
      });
    const money = { currency_code: 'GBP', value: '10.00' };
    const order = await (
      await post('/v2/checkout/orders', { intent: 'AUTHORIZE', purchase_units: [{ custom_id: 'hold', amount: money }] })
    ).json();
    expect((await post(`/__sim/approve/${order.id}`, {})).status).toBe(200);
    const authorized = await (await post(`/v2/checkout/orders/${order.id}/authorize`, {})).json();
    const auth = authorized.purchase_units[0].payments.authorizations[0].id;
    expect((await post(`/v2/payments/authorizations/${auth}/reauthorize`, { amount: money })).status).toBe(422);
    for (const body of [
      { amount: { ...money, value: '11.00' }, final_capture: true, invoice_id: 'op' },
      { amount: money, final_capture: false, invoice_id: 'op' },
      { amount: money, final_capture: true },
    ])
      expect((await post(`/v2/payments/authorizations/${auth}/capture`, body)).status).toBe(422);
    expect((await (await sim.app.request(`/v2/payments/authorizations/${auth}`, { headers })).json()).status).toBe(
      'CREATED',
    );
    now = 4 * 86400000;
    expect((await post(`/v2/payments/authorizations/${auth}/reauthorize`, { amount: money })).status).toBe(201);
    expect((await post(`/v2/payments/authorizations/${auth}/reauthorize`, { amount: money })).status).toBe(422);
    expect(sim.events().some((e) => e.event_type === 'PAYMENT.CAPTURE.COMPLETED')).toBe(false);
  });
  it('never captures twice across an authorisation renewal lineage', async () => {
    let now = 0;
    const sim = createPayPalSimulator({ environment: 'ci', clock: () => now });
    let key = 0;
    const post = (path: string, body: unknown) =>
      sim.app.request(path, {
        method: 'POST',
        headers: { ...headers, 'PayPal-Request-Id': `lineage-${++key}` },
        body: JSON.stringify(body),
      });
    const money = { currency_code: 'USD', value: '10.00' };
    const order = await (
      await post('/v2/checkout/orders', {
        intent: 'AUTHORIZE',
        purchase_units: [{ custom_id: 'lineage', amount: money }],
      })
    ).json();
    sim.approve(order.id);
    const authorised = await (await post(`/v2/checkout/orders/${order.id}/authorize`, {})).json();
    const original = authorised.purchase_units[0].payments.authorizations[0].id;
    now = 4 * 86400000;
    const renewal = await (await post(`/v2/payments/authorizations/${original}/reauthorize`, { amount: money })).json();
    const capture = (auth: string) =>
      post(`/v2/payments/authorizations/${auth}/capture`, {
        amount: money,
        final_capture: true,
        invoice_id: `op-${auth}`,
      });
    expect((await capture(renewal.id)).status).toBe(201);
    expect((await capture(original)).status).toBe(422);
    const stored = await (await sim.app.request(`/v2/checkout/orders/${order.id}`, { headers })).json();
    expect(stored.purchase_units[0].payments.captures).toHaveLength(1);
  });
  it('is visibly simulated, rejects hosted boot and authenticates synthetic credentials only', async () => {
    expect(() => createPayPalSimulator({ environment: 'production', clock: Date.now })).toThrow();
    const { app } = createPayPalSimulator({ environment: 'ci', clock: Date.now });
    expect(await (await app.request('/health')).json()).toMatchObject({
      simulated: true,
      provider: 'paypal',
      mode: 'sim',
    });
    expect((await app.request('/v2/checkout/orders')).status).toBe(401);
    const token = await app.request('/v1/oauth2/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from('sim-client:sim-secret').toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    expect(await token.json()).toMatchObject({ access_token: 'sim-access-token', token_type: 'Bearer' });
    expect(token.headers.get('x-stood-simulated')).toBe('true');
    expect(
      (
        await app.request('/v1/oauth2/token', {
          method: 'POST',
          headers: { Authorization: 'Basic invalid' },
          body: 'grant_type=client_credentials',
        })
      ).status,
    ).toBe(401);
  });
  it('requires approval, preserves idempotency and rejects changed requests', async () => {
    const sim = createPayPalSimulator({ environment: 'ci', clock: () => 0 });
    const body = JSON.stringify({
      intent: 'AUTHORIZE',
      purchase_units: [{ custom_id: 'tranche', amount: { currency_code: 'USD', value: '10.00' } }],
    });
    const request = () => sim.app.request('/v2/checkout/orders', { method: 'POST', headers, body });
    const order = await (await request()).json();
    expect(await (await request()).json()).toEqual(order);
    expect(
      (await sim.app.request('/v2/checkout/orders', { method: 'POST', headers, body: body.replace('10.00', '11.00') }))
        .status,
    ).toBe(422);
    const authorize = () =>
      sim.app.request(`/v2/checkout/orders/${order.id}/authorize`, {
        method: 'POST',
        headers: { ...headers, 'PayPal-Request-Id': 'authorize' },
        body: '{}',
      });
    expect((await authorize()).status).toBe(422);
    sim.approve(order.id);
    // The failed request id is sticky, as a retry against PayPal would be.
    expect((await authorize()).status).toBe(422);
    const success = await sim.app.request(`/v2/checkout/orders/${order.id}/authorize`, {
      method: 'POST',
      headers: { ...headers, 'PayPal-Request-Id': 'new-authorize' },
      body: '{}',
    });
    expect(success.status).toBe(201);
    expect(await success.json()).toMatchObject({ status: 'COMPLETED' });
  });
  it('models setup approval, token creation and revocation without real payer details', async () => {
    const sim = createPayPalSimulator({ environment: 'ci', clock: () => 0 });
    const setup = await (
      await sim.app.request('/v3/vault/setup-tokens', {
        method: 'POST',
        headers,
        body: JSON.stringify({ payment_source: { paypal: { usage_type: 'MERCHANT' } } }),
      })
    ).json();
    expect(setup.status).toBe('PAYER_ACTION_REQUIRED'); // as the real sandbox answers a MERCHANT setup token
    sim.approveSetup(setup.id);
    const response = await sim.app.request('/v3/vault/payment-tokens', {
      method: 'POST',
      headers: { ...headers, 'PayPal-Request-Id': 'vault' },
      body: JSON.stringify({ payment_source: { token: { id: setup.id, type: 'SETUP_TOKEN' } } }),
    });
    expect(response.status).toBe(201);
    const payment = await response.json();
    expect(payment.id).toMatch(/^SIM/);
    expect(
      (await sim.app.request(`/v3/vault/payment-tokens/${payment.id}`, { method: 'DELETE', headers })).status,
    ).toBe(204);
    expect((await sim.app.request(`/v3/vault/payment-tokens/${payment.id}`, { headers })).status).toBe(404);
  });
});
