import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PayPalInput, PayPalTransport } from '../../src/adapters/payments-paypal/sdk.js';
export type PayPalHarness = {
  transport: PayPalTransport;
  input: PayPalInput;
  advance(days: number): void;
  close(): Promise<void>;
};
export function paypalTransportContract(name: string, setup: () => Promise<PayPalHarness>) {
  describe(`PayPal transport contract: ${name}`, () => {
    let h: PayPalHarness;
    beforeEach(async () => {
      h = await setup();
    });
    afterEach(async () => {
      await h?.close();
    });
    it('captures exactly once and replays the same request identifier', async () => {
      const result = await h.transport.call('CAPTURE', h.input);
      expect(result.status).toBe(201);
      expect(result.body).toMatchObject({
        status: 'COMPLETED',
        invoice_id: h.input.operationKey,
        amount: { currency_code: 'USD', value: '10.00' },
      });
      expect(await h.transport.call('CAPTURE', h.input)).toEqual(result);
      const second = await h.transport.call('CAPTURE', { ...h.input, requestId: 'different-request' });
      expect(second.status).toBe(422);
      expect((await h.transport.call('GET_AUTHORIZATION', h.input)).body).toMatchObject({ status: 'CAPTURED' });
    });
    it('cancels without reporting a capture', async () => {
      expect((await h.transport.call('VOID', h.input)).status).toBe(204);
      expect((await h.transport.call('GET_AUTHORIZATION', h.input)).body).toMatchObject({ status: 'VOIDED' });
      expect((await h.transport.call('CAPTURE', { ...h.input, requestId: 'late-capture' })).status).toBe(422);
    });
    it('renews from day four with one stable new authorisation', async () => {
      h.advance(4);
      const result = await h.transport.call('REAUTHORIZE', h.input);
      expect(result.status).toBe(201);
      expect(result.body).toMatchObject({ status: 'CREATED', amount: { currency_code: 'USD', value: '10.00' } });
      expect((result.body as { id: string }).id).not.toBe(h.input.authorizationId);
      expect(await h.transport.call('REAUTHORIZE', h.input)).toEqual(result);
      expect((await h.transport.call('REAUTHORIZE', { ...h.input, requestId: 'second-renewal' })).status).toBe(422);
    });
    it('does not capture an expired authorisation', async () => {
      h.advance(29);
      expect((await h.transport.call('GET_AUTHORIZATION', h.input)).body).toMatchObject({ status: 'EXPIRED' });
      expect((await h.transport.call('CAPTURE', h.input)).status).toBe(422);
    });
    it('rejects missing identities and keeps failures opaque', async () => {
      expect((await h.transport.call('GET_AUTHORIZATION', { ...h.input, authorizationId: 'missing' })).status).toBe(
        404,
      );
    });
  });
}
