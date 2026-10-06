import { expect, it } from 'vitest';
import { WebhookNotifier } from '../notify/webhook.js';
import { HttpBrowserQa } from './http-qa.js';

it('checks a preview page for expected text and reports findings only (T-0228)', async () => {
  const qa = new HttpBrowserQa(async () => new Response('<h1>Book a slot</h1><p>Deposit paid</p>', { status: 200 }));
  expect(
    await qa.check('https://yard-preview.onrender.com', [
      { action: 'visit' },
      { action: 'expectText', text: 'Book a slot' },
      { action: 'expectText', text: 'Deposit paid' },
    ]),
  ).toEqual({
    passed: true,
    observations: ['visit 200', 'found: Book a slot', 'found: Deposit paid'],
    simulated: true,
  });
  const missing = await qa.check('https://yard-preview.onrender.com', [
    { action: 'visit' },
    { action: 'expectText', text: 'Refund' },
  ]);
  expect(missing).toMatchObject({ passed: false, observations: ['visit 200', 'missing: Refund'] });
  const down = new HttpBrowserQa(async () => {
    throw new Error('down');
  });
  expect((await down.check('https://x.onrender.com', [{ action: 'visit' }])).passed).toBe(false);
  expect((await qa.check('javascript:alert(1)', [{ action: 'visit' }])).passed).toBe(false);
  const failing = new HttpBrowserQa(async () => new Response('', { status: 500 }));
  expect((await failing.check('https://x.onrender.com', [{ action: 'visit' }])).observations).toEqual(['visit 500']);
});
it('posts notices outbound to an https catch hook only (T-0228)', async () => {
  const sent: Request[] = [];
  const notifier = new WebhookNotifier('https://hooks.example.invalid/catch/1', async (r) => {
    sent.push(r);
    return new Response('{}', { status: 200 });
  });
  await notifier.send({ key: 'k', to: 'buyer@example.invalid', subject: 'Milestone paid', text: '$10.00 released.' });
  expect(await sent[0]?.json()).toEqual({
    key: 'k',
    to: 'buyer@example.invalid',
    subject: 'Milestone paid',
    text: '$10.00 released.',
    simulated: true,
  });
  expect(() => new WebhookNotifier('http://hooks.example.invalid/catch')).toThrow();
  const refusing = new WebhookNotifier(
    'https://hooks.example.invalid/c',
    async () => new Response('', { status: 410 }),
  );
  await expect(refusing.send({ key: 'k', to: 'a', subject: 's', text: 't' })).rejects.toThrow();
});
