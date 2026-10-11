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

  // Third audit (2026-10-11): PayPal's contract, not a guess. A reused sender_batch_id is rejected with a HATEOAS link
  // to the original payout (which was sent); 5xx, 401 and 429 are retryable; only a validated refusal is final.
  it('recovers the original batch from a duplicate, retries what is retryable, and fails only a real refusal', async () => {
    const duplicate = {
      name: 'USER_BUSINESS_ERROR',
      message: 'User business error.',
      debug_id: 'dbg-dup',
      details: [{ field: 'SENDER_BATCH_ID', issue: `Batch with given sender_batch_id already exists: ${batchId}` }],
      links: [{ href: 'https://api-m.sandbox.paypal.com/v1/payments/payouts/PBORIGINAL1', rel: 'self', method: 'GET' }],
    };
    const send = async (answer: { status: number; body: unknown } | 'drop') =>
      paypal({ '/v1/oauth2/token': token, '/v1/payments/payouts': answer }).payouts.send(request);
    expect(await send({ status: 400, body: duplicate })).toEqual({ outcome: 'SENT', payoutBatchId: 'PBORIGINAL1' });
    expect(await send({ status: 400, body: { ...duplicate, links: [] } })).toEqual({
      outcome: 'REVIEW',
      reason: 'duplicate_without_link',
    });
    expect(
      await send({
        status: 422,
        body: { name: 'UNPROCESSABLE_ENTITY', debug_id: 'dbg123', details: [{ issue: 'RECEIVER_UNREGISTERED' }] },
      }),
    ).toEqual({ outcome: 'REFUSED', reference: 'dbg123' });
    for (const [answer, reason] of [
      ['drop', 'no_answer'],
      [{ status: 500, body: { debug_id: 'x' } }, 'http_500'],
      [{ status: 503, body: {} }, 'http_503'],
      [{ status: 401, body: { name: 'AUTHENTICATION_FAILURE', debug_id: 'x' } }, 'http_401'],
      [{ status: 429, body: { name: 'RATE_LIMIT_REACHED', debug_id: 'x' } }, 'http_429'],
      [{ status: 409, body: { debug_id: 'x' } }, 'http_409'],
      [{ status: 201, body: {} }, 'http_201'],
      [{ status: 422, body: { name: 'UNPROCESSABLE_ENTITY' } }, 'http_422'],
    ] as const)
      expect(await send(answer)).toEqual({ outcome: 'UNKNOWN', reason });
  });

  it('pays a merchant id as a PayPal id, fetches a new token after a 401, and maps every PayPal item status', async () => {
    const h = paypal({
      '/v1/oauth2/token': token,
      '/v1/payments/payouts': { status: 401, body: { name: 'AUTHENTICATION_FAILURE' } },
    });
    await h.payouts.send({ ...request, payee: 'ABCDEFGHJKLMN' });
    expect(JSON.parse(String(h.calls[1]?.init.body)).items[0].recipient_type).toBe('PAYPAL_ID');
    await h.payouts.send(request);
    expect(h.calls.filter((c) => c.url.endsWith('/oauth2/token'))).toHaveLength(2);
    for (const [paypalStatus, ours] of [
      ['SUCCESS', 'PAID_OUT'],
      ['UNCLAIMED', 'UNCLAIMED'],
      ['RETURNED', 'RETURNED'],
      ['REFUNDED', 'RETURNED'],
      ['REVERSED', 'RETURNED'],
      ['FAILED', 'FAILED'],
      ['BLOCKED', 'REVIEW'],
      ['PENDING', 'PENDING'],
      ['ONHOLD', 'PENDING'],
      ['SOMETHING_NEW', 'UNKNOWN'],
    ]) {
      const r = paypal({
        '/v1/oauth2/token': token,
        status: { status: 200, body: { items: [{ transaction_status: paypalStatus }] } },
      });
      expect((await r.payouts.status('PB12345678')).status, paypalStatus).toBe(ours);
    }
    expect(await h.payouts.status('../etc')).toEqual({ status: 'UNKNOWN' });
    // Fourth audit: a status read that gets a 401 also drops the token.
    const reads = paypal({
      '/v1/oauth2/token': token,
      status: { status: 401, body: { name: 'AUTHENTICATION_FAILURE' } },
    });
    expect(await reads.payouts.status('PB12345678')).toEqual({ status: 'UNKNOWN' });
    await reads.payouts.status('PB12345678');
    expect(reads.calls.filter((c) => c.url.endsWith('/oauth2/token'))).toHaveLength(2);
    await expect(h.payouts.send({ ...request, batchId: 'other' })).rejects.toThrow('INVALID_PAYOUT');
  });
});
