import { expect, it } from 'vitest';
import { MailpitNotifier } from './mailpit.js';

it('posts a simulated notice to the local Mailpit send API only (T-0213)', async () => {
  const requests: Request[] = [];
  const notifier = new MailpitNotifier('http://mail:8025', 'yard@example.invalid', async (r) => {
    requests.push(r);
    return new Response('{}', { status: 200 });
  });
  await notifier.send({ key: 'k', to: 'buyer@example.invalid', subject: 'Project closed', text: 'Closed.' });
  expect(requests[0]?.url).toBe('http://mail:8025/api/v1/send');
  expect(await requests[0]?.json()).toMatchObject({
    To: [{ Email: 'buyer@example.invalid' }],
    Subject: 'Project closed',
    Headers: { 'X-Yard-Notice': 'k', 'X-Stood-Simulated': 'true' },
  });
  expect(() => new MailpitNotifier('https://smtp.example.com')).toThrow('Local Mailpit only');
  const refusing = new MailpitNotifier('http://mail:8025', undefined, async () => new Response('', { status: 500 }));
  await expect(refusing.send({ key: 'k', to: 'a@b.c', subject: 's', text: 't' })).rejects.toThrow();
});
