import { describe, expect, it, vi } from 'vitest';
import { PayPalPayouts } from './payouts.js';

const batchId = `yard-${'a'.repeat(40)}`;
function paypal(answers: Record<string, { status: number; body: unknown } | 'drop'>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const path = new URL(String(url)).pathname;
    const answer = answers[path.startsWith('/v1/payments/payouts/') ? 'status' : path] ?? { status: 500, body: {} };
    if (answer === 'drop') throw new Error('socket hang up');
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  });
  const payouts = new PayPalPayouts({
    clientId: 'yard-client',
    clientSecret: 'yard-secret',
    baseUrl: 'https://api-m.sandbox.paypal.com',
    fetch,
  });
  return { payouts, calls };
}
const token = { status: 200, body: { access_token: 'A21-not-real', expires_in: 32400 } };
const request = { batchId, payee: 'builder@example.com', minor: 50_000, currency: 'GBP', note: 'Yard work order one' };

// ADR-0027: Yard's own PayPal account pays the builder, once per work order.
describe('PayPalPayouts', () => {
  it('sends one item for the builder price, idempotent on the batch id, and reads the item status', async () => {
    const h = paypal({
      '/v1/oauth2/token': token,
      '/v1/payments/payouts': {
        status: 201,
        body: { batch_header: { payout_batch_id: 'PB12345678', batch_status: 'PENDING' } },
      },
      status: { status: 200, body: { items: [{ transaction_status: 'SUCCESS', transaction_id: 'TXN0001' }] } },
    });
    expect(await h.payouts.send(request)).toEqual({ outcome: 'SENT', payoutBatchId: 'PB12345678' });
    const post = h.calls[1] as { url: string; init: RequestInit };
    expect((post.init.headers as Record<string, string>)['PayPal-Request-Id']).toBe(batchId);
    expect(JSON.parse(String(post.init.body))).toMatchObject({
      sender_batch_header: { sender_batch_id: batchId },
      items: [
        { recipient_type: 'EMAIL', receiver: 'builder@example.com', amount: { value: '500.00', currency: 'GBP' } },
      ],
    });
    expect(await h.payouts.status('PB12345678')).toEqual({ status: 'PAID_OUT', reference: 'TXN0001' });
    // The token is reused.
    expect(h.calls.filter((c) => c.url.endsWith('/oauth2/token'))).toHaveLength(1);
  });

  it('pays a merchant id as a PayPal id, and never guesses: a refusal is final, anything else unknown', async () => {
    const refused = paypal({
      '/v1/oauth2/token': token,
      '/v1/payments/payouts': { status: 422, body: { name: 'UNPROCESSABLE_ENTITY', debug_id: 'dbg123' } },
    });
    expect(await refused.payouts.send({ ...request, payee: 'ABCDEFGHJKLMN' })).toEqual({
      outcome: 'REFUSED',
      reference: 'dbg123',
    });
    expect(JSON.parse(String(refused.calls[1]?.init.body)).items[0].recipient_type).toBe('PAYPAL_ID');
    for (const answer of [
      'drop',
      { status: 500, body: {} },
      { status: 409, body: { debug_id: 'x' } },
      { status: 201, body: {} },
    ] as const) {
      const h = paypal({ '/v1/oauth2/token': token, '/v1/payments/payouts': answer });
      expect(await h.payouts.send(request)).toEqual({ outcome: 'UNKNOWN' });
    }
    const unread = paypal({
      '/v1/oauth2/token': token,
      status: { status: 200, body: { items: [{ transaction_status: 'WEIRD' }] } },
    });
    expect(await unread.payouts.status('PB12345678')).toEqual({ status: 'UNKNOWN' });
    expect(await unread.payouts.status('../etc')).toEqual({ status: 'UNKNOWN' });
    await expect(refused.payouts.send({ ...request, batchId: 'other' })).rejects.toThrow('INVALID_PAYOUT');
  });
});
