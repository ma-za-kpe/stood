import { expect, it, vi } from 'vitest';
import { hostedSession } from './hosted-session.js';

it('refreshes once after a session expires and preserves the exact request', async () => {
  const login = vi.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second');
  const send = vi
    .fn()
    .mockResolvedValueOnce(new Response('', { status: 401 }))
    .mockResolvedValueOnce(new Response('ok'));
  const request = { method: 'POST', body: '{}', headers: { 'Idempotency-Key': 'same-key' } };
  const call = await hostedSession(login, send);
  expect((await call('/usage', request)).status).toBe(200);
  expect(login).toHaveBeenCalledTimes(2);
  expect(send.mock.calls).toEqual([
    ['first', '/usage', request],
    ['second', '/usage', request],
  ]);
});

it('bounds repeated unauthorized responses and does not retry forbidden or unknown outcomes', async () => {
  for (const status of [401, 403, 503]) {
    const login = vi.fn(async () => 'cookie');
    const send = vi.fn(async () => new Response('', { status }));
    const call = await hostedSession(login, send);
    expect((await call('/work', { method: 'GET' })).status).toBe(status);
    expect(send).toHaveBeenCalledTimes(status === 401 ? 2 : 1);
  }
  const send = vi.fn(async () => {
    throw new Error('unknown transport outcome');
  });
  const call = await hostedSession(async () => 'cookie', send);
  await expect(call('/usage', { method: 'POST' })).rejects.toThrow('unknown transport outcome');
  expect(send).toHaveBeenCalledTimes(1);
});
