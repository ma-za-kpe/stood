import type { PayPalCall, PayPalInput, PayPalTransport } from '../../src/adapters/payments-paypal/sdk.js';
// Deliberately separate from the HTTP simulator model: shared contracts catch drift.
export class FakePayPalTransport implements PayPalTransport {
  readonly input: PayPalInput = {
    authorizationId: 'fake-auth',
    requestId: 'fake-request',
    operationKey: 'fake-op',
    amount: { currencyCode: 'USD', value: '10.00' },
  };
  private days = 0;
  private state = 'CREATED';
  private renewed = false;
  private cache = new Map<string, { input: string; result: { status: number; body: unknown } }>();
  advance(days: number) {
    this.days += days;
  }
  async call(action: PayPalCall, input: PayPalInput) {
    if (input.authorizationId !== this.input.authorizationId)
      return { status: 404, body: { name: 'RESOURCE_NOT_FOUND' } };
    const key = `${action}:${input.requestId}`;
    if (!action.startsWith('GET_')) {
      const cached = this.cache.get(key);
      if (cached)
        return cached.input === JSON.stringify(input)
          ? structuredClone(cached.result)
          : { status: 422, body: { name: 'UNPROCESSABLE_ENTITY' } };
    }
    if (this.days >= 29 && this.state === 'CREATED') this.state = 'EXPIRED';
    const amount = { currency_code: 'USD', value: '10.00' };
    let result: { status: number; body: unknown };
    if (action === 'GET_AUTHORIZATION') result = { status: 200, body: { id: 'fake-auth', status: this.state, amount } };
    else if (this.state !== 'CREATED')
      result = {
        status: 422,
        body: {
          name: 'UNPROCESSABLE_ENTITY',
          details: [{ issue: this.state === 'EXPIRED' ? 'AUTHORIZATION_EXPIRED' : 'AUTHORIZATION_ALREADY_CAPTURED' }],
          debug_id: 'fake-debug',
        },
      };
    else if (action === 'CAPTURE') {
      this.state = 'CAPTURED';
      result = {
        status: 201,
        body: {
          id: 'fake-capture',
          status: 'COMPLETED',
          amount,
          invoice_id: input.operationKey,
          supplementary_data: { related_ids: { authorization_id: 'fake-auth', order_id: 'fake-order' } },
        },
      };
    } else if (action === 'VOID') {
      this.state = 'VOIDED';
      // Stood always sends Prefer: return=representation, so PayPal answers 200 with the authorization.
      result = { status: 200, body: { id: input.authorizationId, status: 'VOIDED', amount } };
    } else if (action === 'REAUTHORIZE' && this.days >= 3 && !this.renewed) {
      this.renewed = true;
      result = { status: 201, body: { id: 'fake-renewed-auth', status: 'CREATED', amount } };
    } else result = { status: 422, body: { name: 'UNPROCESSABLE_ENTITY' } };
    if (!action.startsWith('GET_'))
      this.cache.set(key, { input: JSON.stringify(input), result: structuredClone(result) });
    return structuredClone(result);
  }
}
