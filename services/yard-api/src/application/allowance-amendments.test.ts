import { createHash } from 'node:crypto';
import type { AllowanceVersionView, BaselineInput, BaselineView, MandateView } from '@stood/stood-sdk';
import { expect, it, vi } from 'vitest';
import { leaseAt, leaseBuyer } from '../../test/fakes/board-fixture.js';
import { MemoryEvents } from '../../test/fakes/events.js';
import { AllowanceAmendments, type AmendmentGateway } from './allowance-amendments.js';
import { Board } from './board.js';
import type { MandateRequest } from './board-state.js';
import { MandateBridge } from './mandate-bridge.js';

async function setup() {
  const board = new Board(new MemoryEvents());
  const tests = [{ id: 'works', path: 'tests/works.test.js' }];
  const manifestHash = createHash('sha256').update(JSON.stringify(tests)).digest('hex');
  const milestones = ['one', 'two'].map((id) => ({
    id,
    name: id,
    budgetMinor: 1000,
    deadline: leaseAt + 86400000,
    profileId: id === 'two' ? ('code.final@1' as const) : ('code.milestone@1' as const),
    testBundleHash: 'a'.repeat(64),
    manifestHash,
    testIds: ['works'],
    tests,
  }));
  await board.create(
    {
      id: 'p',
      buyerOperatorId: 'buyer',
      repository: 'buyer/project',
      baseCommit: 'a'.repeat(40),
      summary: 'Booking',
      createdAt: leaseAt,
      capMinor: 2000,
      currency: 'USD',
      milestones,
    },
    leaseBuyer,
    'create',
  );
  await board.freeze(
    'p',
    {
      version: 1,
      buyerOperatorId: 'buyer',
      approvalReference: 'approved',
      baselines: milestones.map((m) => ({
        milestoneId: m.id,
        testBundleHash: m.testBundleHash,
        manifestHash,
        failedTestIds: m.testIds,
        reference: 'baseline-original',
      })),
    },
    leaseBuyer,
    1,
    'freeze',
  );
  await new MandateBridge(board, {
    createDraft: async () => ({ id: 'alw_1', tranches: milestones.map((m) => ({ id: `trn_${m.id}`, name: m.name })) }),
  }).create('p', leaseBuyer, 2, 'mandate', leaseAt);
  const changes = [{ milestoneId: 'two', testBundleHash: 'b'.repeat(64), manifestHash, testIds: ['works'], tests }];
  let approved = false;
  const gateway: AmendmentGateway = {
    requestBaseline: vi.fn(
      async (terms: BaselineInput): Promise<BaselineView> => ({
        id: 'bl_2',
        status: 'DONE',
        repository: terms.repository,
        baseCommit: terms.baseCommit,
        testBundleHash: terms.testBundleHash,
        tests: terms.testIds.map((id) => ({ id, status: 'FAIL' as const })),
        evidenceSha256: 'c'.repeat(64),
      }),
    ),
    proposeAllowanceVersion: vi.fn(
      async (_id: string, version: number, input: MandateRequest): Promise<AllowanceVersionView> => ({
        version: version + 1,
        termsHash: 'd'.repeat(64),
        body: {
          ...input,
          id: 'alw_1',
          status: 'DRAFT',
          tranches: milestones.map((m) => ({ id: `trn_${m.id}`, name: m.name })),
        },
      }),
    ),
    requestVersionMandate: vi.fn(
      async (_id: string, _version: number, key: string): Promise<MandateView> => ({
        key,
        status: approved ? 'SIGNED' : 'AWAITING_APPROVAL',
        approveUrl: approved ? null : 'https://www.sandbox.paypal.com/agreements/approve?ba_token=fixture',
        expiresAt: leaseAt + 86400000,
      }),
    ),
  };
  return {
    board,
    changes,
    gateway,
    approve: () => {
      approved = true;
    },
    bridge: new AllowanceAmendments(board, gateway),
    version: async () => (await board.events.load('p')).version,
  };
}
it('reserves and fences changed work before external calls, then applies terms only after matching Stood consent', async () => {
  const h = await setup();
  const before = await h.version();
  const waiting = await h.bridge.propose('p', leaseBuyer, before, 'change', h.changes);
  expect(waiting.status).toBe('AWAITING_APPROVAL');
  expect((await h.board.room('p', leaseBuyer)).mandate?.amendmentRequired).toEqual(['two']);
  const events = await h.board.events.read('p', 0);
  expect(events.some((e) => e.type === 'stood.amendment_reserved')).toBe(true);
  h.approve();
  const signed = await h.bridge.propose('p', leaseBuyer, before, 'change', h.changes);
  expect(signed.status).toBe('SIGNED');
  expect((await h.board.room('p', leaseBuyer)).mandate).toMatchObject({ termsVersion: 2 });
  expect((await h.board.room('p', leaseBuyer)).mandate?.amendmentRequired).toBeUndefined();
  expect(await h.bridge.propose('p', leaseBuyer, before, 'change', h.changes)).toEqual(signed);
  await expect(
    h.bridge.propose('p', { ...leaseBuyer, root: 'other' }, await h.version(), 'foreign', h.changes),
  ).rejects.toThrow('FORBIDDEN');
});
it('waits for actual failing baselines and preserves the reservation after a lost Stood response', async () => {
  const h = await setup();
  vi.mocked(h.gateway.requestBaseline).mockResolvedValueOnce({
    id: 'bl_2',
    status: 'QUEUED',
    repository: 'buyer/project',
    baseCommit: 'a'.repeat(40),
    testBundleHash: 'b'.repeat(64),
    tests: null,
    evidenceSha256: null,
  });
  const version = await h.version();
  expect((await h.bridge.propose('p', leaseBuyer, version, 'change', h.changes)).status).toBe('BASELINE_RUNNING');
  expect(h.gateway.proposeAllowanceVersion).not.toHaveBeenCalled();
  vi.mocked(h.gateway.proposeAllowanceVersion).mockRejectedValueOnce(new Error('reply lost'));
  await expect(h.bridge.propose('p', leaseBuyer, version, 'change', h.changes)).rejects.toThrow('reply lost');
  expect((await h.bridge.recover())[0]?.status).toBe('AWAITING_APPROVAL');
  const calls = vi.mocked(h.gateway.proposeAllowanceVersion).mock.calls;
  expect(calls[0]).toEqual(calls[1]);
});
it('refuses passing baseline evidence before a successor or consent request', async () => {
  const h = await setup();
  vi.mocked(h.gateway.requestBaseline).mockResolvedValue({
    id: 'bl_2',
    status: 'DONE',
    repository: 'buyer/project',
    baseCommit: 'a'.repeat(40),
    testBundleHash: 'b'.repeat(64),
    tests: [{ id: 'works', status: 'PASS' }],
    evidenceSha256: 'c'.repeat(64),
  });
  expect((await h.bridge.propose('p', leaseBuyer, await h.version(), 'change', h.changes)).status).toBe(
    'NEEDS_REVISION',
  );
  expect(h.gateway.proposeAllowanceVersion).not.toHaveBeenCalled();
});

it('keeps the fence on a mismatched Stood response and refuses changes to posted work', async () => {
  const h = await setup();
  vi.mocked(h.gateway.proposeAllowanceVersion).mockImplementation(async (...args) => {
    const value = await setup();
    const receipt = await value.gateway.proposeAllowanceVersion(...args);
    return { ...receipt, body: { ...receipt.body, payee_ref: 'other-payee' } };
  });
  await expect(h.bridge.propose('p', leaseBuyer, await h.version(), 'bad-reply', h.changes)).rejects.toThrow('INVALID');
  expect(h.gateway.requestVersionMandate).not.toHaveBeenCalled();
  expect((await h.board.room('p', leaseBuyer)).mandate?.amendmentRequired).toEqual(['two']);
  const posted = await setup();
  await posted.board.post('p', 'two', undefined, leaseBuyer, await posted.version(), 'post', leaseAt);
  await expect(
    posted.bridge.propose('p', leaseBuyer, await posted.version(), 'too-late', posted.changes),
  ).rejects.toThrow('CONFLICT');
  expect(posted.gateway.requestBaseline).not.toHaveBeenCalled();
});

it('requires an explicit buyer renewal after consent is revoked and keeps the same terms version', async () => {
  const h = await setup();
  vi.mocked(h.gateway.requestVersionMandate).mockImplementationOnce(async (_id, _version, key) => ({
    key,
    status: 'REVOKED',
    approveUrl: null,
    expiresAt: leaseAt + 1,
  }));
  const result = await h.bridge.propose('p', leaseBuyer, await h.version(), 'change', h.changes);
  expect(result.status).toBe('REVOKED');
  const renewed = await h.bridge.renew('p', leaseBuyer, await h.version(), 'renew', result.key);
  expect(renewed).toMatchObject({ status: 'AWAITING_APPROVAL', termsVersion: 2, approveUrl: expect.any(String) });
  expect(vi.mocked(h.gateway.requestVersionMandate).mock.calls.at(-1)?.[2]).not.toBe(`${result.key}:consent`);
  h.approve();
  expect((await h.bridge.recover())[0]?.status).toBe('SIGNED');
  expect(vi.mocked(h.gateway.requestVersionMandate).mock.calls.at(-1)?.slice(0, 2)).toEqual(['alw_1', 2]);
});
