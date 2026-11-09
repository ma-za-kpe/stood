import { expect, it } from 'vitest';
import { DemoAutopilot, type DemoDeps, type DemoRun } from './demo-autopilot.js';

const buyer = { id: 'buyer', root: 'buyer-operator', kind: 'BUYER' as const };
type Call = { as: string; method: string; path: string; body?: unknown; key?: string };

function harness(options: { refuse?: string; payout?: string } = {}) {
  const calls: Call[] = [];
  const pushes: { base: string; files: string[] }[] = [];
  const approvals: string[] = [];
  let t = 1_794_000_000_000,
    commit = 0;
  const states = new Map<string, string>();
  const tranche = (id: string) => ({
    id,
    state: states.get(id) ?? 'PENDING',
    version: 3,
    holdExpiresAt: null,
    settlement: null,
    decision:
      states.get(id) === 'WAITING' ? { outcome: 'WAIT' as const, namedField: null, reason: 'usage_pending' } : null,
    amount: { minor: 105, currency: 'USD' },
    packageId: null,
    resubmissionsLeft: 1,
    provider: 'paypal-sandbox' as const,
  });
  const work = new Map<string, string>();
  const deps: DemoDeps = {
    yard: async (as, method, path, body, _version, key) => {
      calls.push({ as, method, path, body, ...(key ? { key } : {}) });
      const wo = path.match(/work-orders\/([a-z]+)/)?.[1] ?? '';
      if (path.endsWith('/room')) return { version: calls.length };
      if (path.endsWith('/mandate'))
        return { allowanceId: 'alw_1', tranches: { home: 'trn_home', menu: 'trn_menu', contact: 'trn_contact' } };
      if (path.endsWith('/ledger'))
        return { lines: [...work.keys()].map((w) => ({ wo: w, state: options.payout ?? 'SENT' })) };
      if (path.endsWith('/submit'))
        states.set(`trn_${wo}`, wo === 'contact' ? 'WAITING' : options.refuse === wo ? 'REFUSED' : 'RELEASED');
      if (path.endsWith('/usage')) states.set(`trn_${wo}`, 'RELEASED');
      if (path.endsWith('/claim')) work.set(wo, 'CLAIMED');
      if (method === 'GET' && wo)
        return { hold: true, state: states.get(`trn_${wo}`) === 'RELEASED' ? 'PAID' : 'BUILDING' };
      return {};
    },
    createDemo: async (input) => {
      calls.push({ as: 'board', method: 'CREATE', path: input.id, body: input });
      return { id: input.id, version: 1, owner: 'buyer', data: {} } as never;
    },
    stood: {
      requestBaseline: async (input) => ({
        id: `bl_${input.testIds[0]}`,
        status: 'QUEUED',
        repository: input.repository,
        baseCommit: input.baseCommit,
        testBundleHash: input.testBundleHash,
        tests: null,
        evidenceSha256: null,
      }),
      getBaseline: async (id) => ({
        id,
        status: 'DONE',
        repository: 'o/r',
        baseCommit: 'b',
        testBundleHash: 'h',
        tests: [{ id: id.slice(3), status: 'FAIL' }],
        evidenceSha256: 'e'.repeat(64),
      }),
      requestVersionMandate: async (_a, _v, key) => ({ key, status: 'RESERVED', approveUrl: null, expiresAt: 1 }),
      getMandate: async (_a, key) =>
        approvals.length
          ? { key, status: 'SIGNED', approveUrl: null, expiresAt: 1 }
          : { key, status: 'AWAITING_APPROVAL', approveUrl: 'https://www.sandbox.paypal.com/approve', expiresAt: 1 },
      requestFunding: async (_id, _v, _n, key) => ({ key, status: 'RESERVED', approveUrl: null, holdExpiresAt: null }),
      getFunding: async (_id, key) => ({ key, status: 'HELD', approveUrl: null, holdExpiresAt: null }),
      getTranche: async (id) => tranche(id) as never,
    },
    approver: { approve: async (url) => void approvals.push(url) },
    repositories: {
      issue: async () => ({ value: 'token', expiresAt: t + 3600_000, simulated: false }),
      head: async () => 'a'.repeat(40),
      seedTests: async () => ({ repository: 'o/r', commit: 'b'.repeat(40), simulated: false }),
      push: async (_token, _repo, _branch, base, files) => {
        pushes.push({ base, files: Object.keys(files) });
        return { repository: 'o/r', commit: String(++commit).padStart(40, 'c'), simulated: false };
      },
    },
    installation: '1',
    repository: 'o/r',
    buyer,
    wake: { watch: async () => {}, usage: async () => {}, payouts: async () => {} },
    clock: () => (t += 10),
    sleep: async () => {},
    log: () => {},
    pollMs: 1,
  };
  return { deps, calls, pushes, approvals };
}
const settle = async (pilot: DemoAutopilot): Promise<DemoRun> => {
  for (let i = 0; i < 200; i++) {
    const run = pilot.status('buyer');
    if (run && run.status !== 'RUNNING') return run;
    await new Promise((r) => setTimeout(r, 1));
  }
  throw new Error('demo did not finish');
};

it('builds and pays three pages in order with one buyer approval and chained Crew commits', async () => {
  const h = harness();
  const pilot = new DemoAutopilot(h.deps);
  const started = pilot.start(buyer);
  expect(started).toMatchObject({ status: 'RUNNING', total: 3, simulated: false });
  const done = await settle(pilot);
  expect(done).toMatchObject({ status: 'DONE', paid: 3, error: null });
  expect(done.tasks.map((t) => t.state)).toEqual(['PAID_OUT', 'PAID_OUT', 'PAID_OUT']);
  expect(h.approvals).toEqual(['https://www.sandbox.paypal.com/approve']);
  expect(h.pushes.map((p) => p.base)).toEqual(['b'.repeat(40), '1'.padStart(40, 'c'), '2'.padStart(40, 'c')]);
  expect(h.calls.filter((c) => c.path.endsWith('/claim')).every((c) => c.as === 'crew')).toBe(true);
  expect(h.calls.filter((c) => c.path.endsWith('/usage')).map((c) => c.as)).toEqual(['buyer']);
  // Every write carries a key derived from the run, so a retry replays the same request.
  expect(h.calls.filter((c) => c.method === 'POST').every((c) => c.key?.startsWith(done.runId))).toBe(true);
});

it('stops on a refusal without paying or starting the next page, and allows one run at a time', async () => {
  const h = harness({ refuse: 'menu' });
  const pilot = new DemoAutopilot(h.deps);
  pilot.start(buyer);
  expect(() => pilot.start(buyer)).toThrow('BUSY');
  const stopped = await settle(pilot);
  expect(stopped).toMatchObject({ status: 'STOPPED', paid: 1 });
  expect(stopped.tasks.map((t) => t.state)).toEqual(['PAID_OUT', 'STOPPED', 'STOPPED']);
  expect(h.pushes).toHaveLength(2);
});

it('stops when a Crew payout needs review, and refuses anyone but the configured buyer', async () => {
  const h = harness({ payout: 'REVIEW' });
  const pilot = new DemoAutopilot(h.deps);
  expect(() => pilot.start({ ...buyer, id: 'someone' })).toThrow('FORBIDDEN');
  pilot.start(buyer);
  expect(await settle(pilot)).toMatchObject({ status: 'STOPPED', paid: 1 });
});

it('caps runs per day', async () => {
  const h = harness();
  const pilot = new DemoAutopilot(h.deps, { perDay: 1 });
  pilot.start(buyer);
  await settle(pilot);
  expect(() => pilot.start(buyer)).toThrow('DAILY_LIMIT');
});
