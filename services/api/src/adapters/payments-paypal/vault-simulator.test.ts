import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { FaultController } from '../../../../simulators/src/faults.js';
import { simulatorServer } from '../../../test/contracts/paypal-simulator.js';
import type { VaultAttempt } from '../../ports/vault-provider.js';
import { ServerSdkTransport } from './sdk.js';
import { PayPalVaultAdapter } from './vault.js';

it('uses the pinned SDK for approval and recovers a lost token reply with matching read-only proof', async () => {
  const h = await simulatorServer(
    new FaultController([{ method: 'POST', path: '/v3/vault/payment-tokens', kind: 'LOST_RESPONSE' }]),
  );
  try {
    const transport = new ServerSdkTransport({
      appEnv: 'ci',
      mode: 'sim',
      baseUrl: h.baseUrl,
      clientId: 'sim-client',
      clientSecret: 'sim-secret',
      vaultReturnUrl: 'http://api:3000/paypal/return',
      vaultCancelUrl: 'http://api:3000/paypal/cancel',
    });
    const adapter = new PayPalVaultAdapter(transport);
    const attempt: VaultAttempt = {
      key: 'fixture-signing',
      platformId: 'fixture',
      allowanceId: 'fixture-allowance',
      termsVersion: 1,
      termsHash: 'a'.repeat(64),
      customerRef: 'b'.repeat(64),
      mode: 'sim',
      status: 'CREATING',
      setupRequestId: randomUUID(),
      tokenRequestId: randomUUID(),
      setupId: null,
      customerId: null,
      payerId: null,
      tokenId: null,
      approvalUrl: null,
    };
    const created = (await adapter.createSetup(attempt)) as {
      setupId: string;
      customerId: string;
      approvalUrl: string;
    };
    expect(created).toMatchObject({ complete: true, outcome: 'CREATED' });
    const awaiting = { ...attempt, ...created, status: 'AWAITING_APPROVAL' as const };
    expect(await adapter.readSetup(awaiting)).toMatchObject({ complete: true, outcome: 'CREATED' });
    expect(
      (
        await fetch(`${h.baseUrl}/__sim/setup-approve/${created.setupId}`, {
          method: 'POST',
          headers: { Authorization: 'Bearer sim-access-token', 'Content-Type': 'application/json' },
          body: '{}',
        })
      ).ok,
    ).toBe(true);
    const approved = (await adapter.readSetup(awaiting)) as { payerId: string };
    expect(approved).toMatchObject({ complete: true, outcome: 'APPROVED' });
    const tokenizing = { ...awaiting, ...approved, status: 'TOKENIZING' as const };
    expect(await adapter.createToken(tokenizing)).toEqual({ complete: false });
    // Simulated candidate delivery replaces a future qualified provider event; it grants no authority by itself.
    const candidate = 'SIM-TOKEN-3';
    expect(await adapter.readToken(tokenizing, candidate)).toMatchObject({
      complete: true,
      outcome: 'TOKENIZED',
      tokenId: candidate,
      payerId: approved.payerId,
      customerId: created.customerId,
    });
    expect(await adapter.readToken({ ...tokenizing, customerRef: 'c'.repeat(64) }, candidate)).toEqual({
      complete: false,
    });
    expect(await adapter.readSetup(tokenizing)).toMatchObject({ complete: false });
  } finally {
    await h.close();
  }
});
