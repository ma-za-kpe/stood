import { expect, it, vi } from 'vitest';
import type { VaultAttempt } from '../../ports/vault-provider.js';
import { PayPalVaultAdapter } from './vault.js';

const attempt: VaultAttempt = {
  key: 'signing',
  platformId: 'buyer',
  allowanceId: 'allowance',
  termsVersion: 1,
  termsHash: 'a'.repeat(64),
  customerRef: 'b'.repeat(64),
  mode: 'live',
  status: 'CREATING',
  setupRequestId: 'setup-request',
  tokenRequestId: 'token-request',
  setupId: null,
  customerId: null,
  payerId: null,
  tokenId: null,
  approvalUrl: null,
};
const customer = { id: 'CUSTOMER', merchant_customer_id: attempt.customerRef };
const setup = {
  id: 'SETUP',
  status: 'CREATED',
  customer,
  payment_source: { paypal: {} },
  links: [{ rel: 'approve', href: 'https://www.sandbox.paypal.com/agreements/approve?ba_token=BA', method: 'GET' }],
};
const approvedAttempt: VaultAttempt = {
  ...attempt,
  status: 'TOKENIZING',
  setupId: 'SETUP',
  customerId: 'CUSTOMER',
  payerId: 'PAYER',
  approvalUrl: setup.links[0]!.href,
};
const token = { id: 'TOKEN', customer, payment_source: { paypal: { payer_id: 'PAYER' } } };
it('binds setup and approval proof to the persisted attempt and merchant customer reference', async () => {
  const vault = vi.fn().mockResolvedValue({ status: 201, body: setup });
  const adapter = new PayPalVaultAdapter({ vault });
  expect(await adapter.createSetup(attempt)).toMatchObject({
    complete: true,
    outcome: 'CREATED',
    key: 'signing',
    termsHash: attempt.termsHash,
    setupId: 'SETUP',
    customerId: 'CUSTOMER',
  });
  expect(vault).toHaveBeenLastCalledWith('CREATE_SETUP', expect.objectContaining({ requestId: 'setup-request' }));
  vault.mockResolvedValue({
    status: 200,
    body: { ...setup, status: 'APPROVED', payment_source: { paypal: { payer_id: 'PAYER' } } },
  });
  expect(await adapter.readSetup({ ...approvedAttempt, status: 'AWAITING_APPROVAL' })).toMatchObject({
    complete: true,
    outcome: 'APPROVED',
    payerId: 'PAYER',
  });
  expect(await adapter.readSetup(attempt, 'SETUP')).toMatchObject({ complete: true, outcome: 'APPROVED' });
});
it('requires complete matching customer and payer proof for token creation and recovery', async () => {
  const vault = vi.fn().mockResolvedValue({ status: 201, body: token });
  const adapter = new PayPalVaultAdapter({ vault });
  const proof = await adapter.createToken(approvedAttempt);
  expect(proof).toMatchObject({
    complete: true,
    outcome: 'TOKENIZED',
    tokenId: 'TOKEN',
    setupId: 'SETUP',
    customerId: 'CUSTOMER',
    payerId: 'PAYER',
    tokenRequestId: 'token-request',
  });
  expect(vault).toHaveBeenLastCalledWith(
    'CREATE_TOKEN',
    expect.objectContaining({ requestId: 'token-request', setupId: 'SETUP' }),
  );
  vault.mockResolvedValue({ status: 200, body: token });
  expect(await adapter.readToken(approvedAttempt, 'TOKEN')).toEqual(proof);
  for (const body of [
    null,
    { ...token, id: 'FOREIGN' },
    { ...token, customer: { ...customer, id: 'OTHER' } },
    { ...token, customer: { ...customer, merchant_customer_id: 'other-terms' } },
    { ...token, payment_source: { paypal: { payer_id: 'OTHER' } } },
    { ...token, payment_source: { card: {}, paypal: { payer_id: 'PAYER' } } },
  ]) {
    vault.mockResolvedValue({ status: 200, body });
    expect(await adapter.readToken(approvedAttempt, 'TOKEN')).toEqual({ complete: false });
  }
});
it('keeps malformed, foreign, unapproved and contradictory setup responses unresolved', async () => {
  const vault = vi.fn();
  const adapter = new PayPalVaultAdapter({ vault });
  for (const body of [
    null,
    { ...setup, id: 'OTHER' },
    { ...setup, status: 'VAULTED' },
    { ...setup, customer: { id: 'CUSTOMER' } },
    { ...setup, customer: { ...customer, merchant_customer_id: 'wrong' } },
    { ...setup, status: 'APPROVED' },
    { ...setup, payment_source: { card: {} } },
    { ...setup, links: [{ rel: 'approve', href: 'https://evil.test/approve' }] },
    { ...setup, links: [...setup.links, ...setup.links] },
    { ...setup, links: [{ rel: 'approve', href: 'https://u:p@www.sandbox.paypal.com/approve' }] },
    { ...setup, links: [{ rel: 'approve', href: 'http://www.sandbox.paypal.com/approve' }] },
  ]) {
    vault.mockResolvedValue({ status: 200, body });
    expect(await adapter.readSetup({ ...attempt, status: 'AWAITING_APPROVAL', setupId: 'SETUP' })).toEqual({
      complete: false,
    });
  }
  vault.mockResolvedValue({ status: 500, body: setup });
  expect(await adapter.createSetup(attempt)).toEqual({ complete: false });
  vault.mockRejectedValue(new Error('private_secret'));
  expect(await adapter.createSetup(attempt)).toEqual({ complete: false });
});
it('never calls Vault from resolved or incorrect phases, or with malformed candidate IDs', async () => {
  const vault = vi.fn();
  const adapter = new PayPalVaultAdapter({ vault });
  expect(await adapter.createSetup({ ...attempt, status: 'RESERVED' })).toEqual({ complete: false });
  expect(await adapter.createToken({ ...approvedAttempt, status: 'AWAITING_APPROVAL' })).toEqual({ complete: false });
  expect(await adapter.readSetup({ ...attempt, status: 'SIGNED' }, 'SETUP')).toEqual({ complete: false });
  expect(await adapter.readSetup(attempt, '../../other')).toEqual({ complete: false });
  expect(await adapter.readToken(approvedAttempt)).toEqual({ complete: false });
  expect(await adapter.createToken({ ...approvedAttempt, payerId: null })).toEqual({ complete: false });
  expect(vault).not.toHaveBeenCalled();
});
