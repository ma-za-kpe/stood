import { expect, it, vi } from 'vitest';
import { codeParams } from '../../test/fixtures/code-terms.js';
import type { Mandate, MandateStore, MandateTerms } from '../ports/mandate-store.js';
import type { StoredDraft } from '../ports/platform-api-store.js';
import type { VaultProvider } from '../ports/vault-provider.js';
import { advanceMandate } from './mandate-signing.js';
import { mandateTermsHash } from './mandate-terms.js';

const draft: StoredDraft = {
  id: 'allowance',
  status: 'DRAFT',
  payee_ref: 'payee',
  cap: { minor: 1000, currency: 'USD' },
  milestones: [
    { name: 'Build', amount: { minor: 1000, currency: 'USD' }, profile: 'code.milestone@1', params: codeParams },
  ],
  window_days: 7,
  max_resubmits: 1,
  tranches: [{ id: 'tranche', name: 'Build' }],
};
function harness(status: Mandate['status'] = 'RESERVED') {
  let row: Mandate = {
    key: 'mandate',
    platformId: 'buyer',
    allowanceId: draft.id,
    termsVersion: 1,
    termsHash: mandateTermsHash(draft),
    customerRef: 'b'.repeat(64),
    mode: 'sim',
    status,
    version: 0,
    setupRequestId: 'setup-request',
    tokenRequestId: 'token-request',
    setupId: status === 'RESERVED' || status === 'CREATING' ? null : 'SETUP',
    approvalUrl:
      status === 'RESERVED' || status === 'CREATING' ? null : 'http://paypal-sim:8080/__sim/setup-approve/SETUP',
    customerId: status === 'RESERVED' || status === 'CREATING' ? null : 'CUSTOMER',
    payerId: status === 'TOKENIZING' || status === 'SIGNED' ? 'PAYER' : null,
    tokenId: status === 'SIGNED' ? 'TOKEN' : null,
    acceptedAt: 1000,
    expiresAt: 10000,
    createdAt: '2026-10-05T00:00:00Z',
  };
  const update = (change: Partial<Mandate>) => {
    row = { ...row, ...change, version: row.version + 1 };
    return structuredClone(row);
  };
  const store: MandateStore = {
    reserve: vi.fn(),
    load: vi.fn(async () => structuredClone(row)),
    beginCreate: vi.fn(async () => update({ status: 'CREATING' })),
    setupCreated: vi.fn(async (_key, receipt) => update({ ...receipt, status: 'AWAITING_APPROVAL' })),
    beginTokenize: vi.fn(async (_key, _version, payerId) => update({ status: 'TOKENIZING', payerId })),
    confirm: vi.fn(async (_key, receipt) => update({ ...receipt, status: 'SIGNED' })),
    revoke: vi.fn(),
  };
  const proof = {
    complete: true,
    key: row.key,
    platformId: row.platformId,
    allowanceId: row.allowanceId,
    termsVersion: row.termsVersion,
    termsHash: row.termsHash,
    customerRef: row.customerRef,
    setupRequestId: row.setupRequestId,
    tokenRequestId: row.tokenRequestId,
    setupId: 'SETUP',
    customerId: 'CUSTOMER',
  };
  const created = { ...proof, outcome: 'CREATED', approvalUrl: 'http://paypal-sim:8080/__sim/setup-approve/SETUP' };
  const approved = { ...proof, outcome: 'APPROVED', payerId: 'PAYER' };
  const tokenized = { ...proof, outcome: 'TOKENIZED', payerId: 'PAYER', tokenId: 'TOKEN' };
  const provider: VaultProvider = {
    createSetup: vi.fn(async () => created),
    readSetup: vi.fn(async () => approved),
    createToken: vi.fn(async () => tokenized),
    readToken: vi.fn(async () => tokenized),
  };
  const terms: MandateTerms = { load: vi.fn(async () => structuredClone(draft)) };
  const run = (candidates?: { setupId?: string; tokenId?: string }, clock = () => 2000) =>
    advanceMandate(store, terms, provider, 'mandate', clock, candidates);
  return { store, provider, terms, run, row: () => row, proof, created, approved, tokenized };
}
it('commits possible submission before setup/token writes and signs only complete matching provider approval', async () => {
  const h = harness();
  vi.mocked(h.provider.createSetup).mockImplementation(async () => {
    expect(h.row().status).toBe('CREATING');
    return h.created;
  });
  expect(await h.run()).toMatchObject({ outcome: 'AWAITING_APPROVAL' });
  vi.mocked(h.provider.createToken).mockImplementation(async () => {
    expect(h.row().status).toBe('TOKENIZING');
    return h.tokenized;
  });
  expect(await h.run()).toMatchObject({ outcome: 'SIGNED' });
  expect(h.store.beginTokenize).toHaveBeenCalledWith('mandate', 2, 'PAYER');
  expect(await h.run()).toMatchObject({ outcome: 'SIGNED' });
  expect(h.provider.createToken).toHaveBeenCalledTimes(1);
});
it('never retries ambiguous setup or token writes even after request-ID retention expires', async () => {
  const create = harness('CREATING');
  expect(await create.run()).toMatchObject({ outcome: 'WAIT' });
  expect(create.provider.createSetup).not.toHaveBeenCalled();
  expect(create.provider.readSetup).not.toHaveBeenCalled();
  vi.mocked(create.provider.readSetup).mockResolvedValue(create.created);
  expect(await create.run({ setupId: 'SETUP' }, () => 20000)).toMatchObject({ outcome: 'AWAITING_APPROVAL' });
  const token = harness('TOKENIZING');
  expect(await token.run()).toMatchObject({ outcome: 'WAIT' });
  expect(token.provider.createToken).not.toHaveBeenCalled();
  expect(await token.run({ tokenId: 'TOKEN' }, () => 20000)).toMatchObject({ outcome: 'SIGNED' });
  expect(token.provider.createToken).not.toHaveBeenCalled();
});
it('recovers an already-approved setup after a lost create reply without requiring an obsolete approval link', async () => {
  const h = harness('CREATING');
  vi.mocked(h.provider.readSetup).mockResolvedValue(h.approved);
  expect(await h.run({ setupId: 'SETUP' })).toMatchObject({ outcome: 'AWAITING_APPROVAL' });
  expect(h.row()).toMatchObject({ setupId: 'SETUP', customerId: 'CUSTOMER', approvalUrl: null });
  expect(h.provider.createSetup).not.toHaveBeenCalled();
  expect(h.provider.createToken).not.toHaveBeenCalled();
  expect(await h.run()).toMatchObject({ outcome: 'SIGNED' });
});
it('prevents new writes on expired or mismatched terms but still recovers historical provider facts', async () => {
  for (const status of ['RESERVED', 'AWAITING_APPROVAL'] as const) {
    const h = harness(status);
    expect(await h.run(undefined, () => 10000)).toMatchObject({ outcome: 'WAIT', reason: 'CONSENT_EXPIRED' });
    expect(h.provider.createSetup).not.toHaveBeenCalled();
    expect(h.provider.createToken).not.toHaveBeenCalled();
  }
  const changed = harness();
  vi.mocked(changed.terms.load).mockResolvedValue({ ...draft, payee_ref: 'other' });
  expect(await changed.run()).toMatchObject({ outcome: 'WAIT', reason: 'TERMS_CHANGED' });
  expect(changed.store.beginCreate).not.toHaveBeenCalled();
  const recover = harness('TOKENIZING');
  vi.mocked(recover.terms.load).mockResolvedValue(null);
  expect(await recover.run({ tokenId: 'TOKEN' })).toMatchObject({ outcome: 'SIGNED' });
});
it('rechecks consent with the server clock immediately before provider writes', async () => {
  const h = harness();
  let calls = 0;
  expect(await h.run(undefined, () => (++calls === 1 ? 2000 : 10000))).toMatchObject({ outcome: 'WAIT' });
  expect(h.row().status).toBe('CREATING');
  expect(h.provider.createSetup).not.toHaveBeenCalled();
});
it('leaves malformed, foreign and unapproved proof unresolved without trusting callback IDs', async () => {
  for (const value of [
    null,
    {},
    { complete: false },
    { ...harness().created, termsHash: 'foreign' },
    { ...harness().created, setupRequestId: 'foreign' },
    { ...harness().created, platformId: 'foreign' },
  ]) {
    const h = harness();
    vi.mocked(h.provider.createSetup).mockResolvedValue(value);
    expect(await h.run()).toMatchObject({ outcome: 'WAIT' });
    expect(h.store.setupCreated).not.toHaveBeenCalled();
  }
  const h = harness('AWAITING_APPROVAL');
  vi.mocked(h.provider.readSetup).mockResolvedValue(h.created);
  expect(await h.run()).toMatchObject({ outcome: 'AWAITING_APPROVAL' });
  expect(h.store.beginTokenize).not.toHaveBeenCalled();
  vi.mocked(h.provider.readSetup).mockResolvedValue({ ...h.approved, setupId: 'foreign' });
  expect(await h.run()).toMatchObject({ outcome: 'WAIT' });
  const token = harness('TOKENIZING');
  vi.mocked(token.provider.readToken).mockResolvedValue({ ...token.tokenized, payerId: 'foreign' });
  expect(await token.run({ tokenId: 'TOKEN' })).toMatchObject({ outcome: 'WAIT' });
  expect(token.store.confirm).not.toHaveBeenCalled();
});
it('preserves unknown outcomes and concurrent claim failures without another provider call', async () => {
  const h = harness();
  vi.mocked(h.store.beginCreate).mockRejectedValue(new Error('stale'));
  expect(await h.run()).toMatchObject({ outcome: 'WAIT' });
  expect(h.provider.createSetup).not.toHaveBeenCalled();
  const token = harness('AWAITING_APPROVAL');
  vi.mocked(token.provider.createToken).mockRejectedValue(new Error('private_secret'));
  expect(await token.run()).toMatchObject({ outcome: 'WAIT' });
  expect(token.row().status).toBe('TOKENIZING');
  expect(await token.run()).toMatchObject({ outcome: 'WAIT' });
  expect(token.provider.createToken).toHaveBeenCalledTimes(1);
});
