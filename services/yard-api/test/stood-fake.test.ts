import { createHmac } from 'node:crypto';
import { serve } from '@hono/node-server';
import { expect, it } from 'vitest';
import { StoodClient } from '../../../packages/stood-sdk/src/client.js';
import { fakeStood } from './fakes/stood.js';

it.each(['WAIT', 'REFUSE', 'RELEASE'] as const)(
  'serves signed SDK requests and a synthetic %s with exact idempotency',
  async (outcome) => {
    const now = 1791158400000;
    const fake = fakeStood({ clock: () => now });
    const server = serve({ fetch: fake.app.fetch, hostname: '127.0.0.1', port: 0 });
    await new Promise<void>((resolve) => (server.listening ? resolve() : server.once('listening', resolve)));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No local listener');
    const client = new StoodClient({
      baseUrl: `http://127.0.0.1:${address.port}`,
      key: 'sim-stood-key',
      secret: 'sim-stood-secret',
      clock: () => now,
    });
    try {
      const draft = {
        payee_ref: 'sim-builder',
        cap: { minor: 1000, currency: 'USD' },
        milestones: [
          { name: 'build', amount: { minor: 1000, currency: 'USD' }, profile: 'code.milestone@1', params: {} },
        ],
        window_days: 7,
        max_resubmits: 1,
      };
      const receipt = await client.createDraft(draft, 'draft-1');
      expect(await client.createDraft(draft, 'draft-1')).toEqual(receipt);
      expect(await client.getDraft(receipt.id)).toEqual(receipt);
      await expect(client.createDraft({ ...draft, payee_ref: 'other' }, 'draft-1')).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      const tranche = receipt.tranches[0];
      if (!tranche) throw new Error('Missing tranche');
      const metadata = {
        repository: 'buyer/project',
        base_commit: 'a'.repeat(40),
        commit_sha: 'b'.repeat(40),
        report_ref: 'reports/one.json',
        report_sha256: 'c'.repeat(64),
      };
      const pkg = await client.submitPackage(tranche.id, metadata, 'package-1');
      expect(await client.getPackage(tranche.id, pkg.id)).toEqual(pkg);
      expect(await client.submitPackage(tranche.id, metadata, 'package-1')).toEqual(pkg);
      await expect(
        client.submitPackage(tranche.id, { ...metadata, commit_sha: 'd'.repeat(40) }, 'package-1'),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      {
        const event = fake.outcome(tranche.id, pkg.id, outcome);
        expect(event).toMatchObject({ simulated: true, payment: { executed: false }, outcome });
        expect(fake.outcome(tranche.id, pkg.id, outcome)).toEqual(event);
        if (outcome !== 'WAIT')
          expect(() => fake.outcome(tranche.id, pkg.id, outcome === 'RELEASE' ? 'REFUSE' : 'RELEASE')).toThrow();
        const signed = fake.signed(event);
        const timestamp = String(now / 1000);
        expect(signed.signature).toBe(
          `t=${timestamp},v1=${createHmac('sha256', 'sim-stood-webhook-secret').update(`${timestamp}.${signed.body}`).digest('hex')}`,
        );
      }
      expect((await fake.app.request('/v1/allowances')).status).toBe(401);
      await expect(client.submitPackage('unknown', metadata, 'other')).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(() => fake.outcome(tranche.id, 'foreign', 'RELEASE')).toThrow();
    } finally {
      if ('closeAllConnections' in server) server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    }
  },
);
