import { expect, it } from 'vitest';
import { HttpTransactionSearch } from './transactions.js';

it('maps Transaction Search captures and refuses unexpected shapes (T-0155)', async () => {
  const body = (details: unknown[]) => new Response(JSON.stringify({ transaction_details: details }), { status: 200 });
  const seen: string[] = [];
  const search = (response: Response) =>
    new HttpTransactionSearch({
      baseUrl: 'http://paypal-sim:8080',
      token: async () => 'sim-access-token',
      transport: async (r) => {
        seen.push(r.url);
        return response;
      },
    });
  const info = {
    transaction_id: 'CAP-1',
    invoice_id: 'op1',
    transaction_amount: { currency_code: 'USD', value: '10.00' },
    transaction_status: 'S',
  };
  expect(await search(body([{ transaction_info: info }])).captures(0, 1)).toEqual([
    { id: 'CAP-1', invoiceId: 'op1', minor: 1000, currency: 'USD', status: 'COMPLETED' },
  ]);
  expect(seen[0]).toContain('/v1/reporting/transactions?start_date=1970-01-01T00%3A00%3A00.000Z');
  await expect(
    search(body([{ transaction_info: { ...info, transaction_amount: { value: '10' } } }])).captures(0, 1),
  ).rejects.toThrow();
  await expect(search(new Response('', { status: 503 })).captures(0, 1)).rejects.toThrow('unavailable');
  expect(
    (await search(body([{ transaction_info: { ...info, invoice_id: 7, transaction_status: 'V' } }])).captures(0, 1))[0],
  ).toMatchObject({
    invoiceId: null,
    status: 'REFUNDED',
  });
});
