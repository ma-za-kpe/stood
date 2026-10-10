import { createHash } from 'node:crypto';
import type { BaselineInput, BaselineView } from '@stood/stood-sdk';
import type { Plan } from '@stood/yard-domain';
import { describe, expect, it } from 'vitest';
import { MemoryEvents } from '../../test/fakes/events.js';
import { FakeRepositories } from '../../test/fakes/github.js';
import { Board } from './board.js';
import { planBlueprint } from './plan-blueprint.js';

const at = 1791158400000;
const buyer = { id: 'buyer', root: 'buyer-root', kind: 'BUYER' as const };
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const tests = [
  { milestoneId: 'one', id: 'books', path: 'tests/books.test.js', content: 'test books' },
  { milestoneId: 'two', id: 'pays', path: 'tests/pays.test.js', content: 'test pays' },
];
function plan(base: string, status: Plan['status'] = 'READY_FOR_BASELINE'): Plan {
  return {
    status,
    version: 2,
    simulated: true,
    requirements: [],
    risks: [],
    tests,
    blueprint: {
      id: 'shop',
      buyerOperatorId: 'buyer',
      repository: 'buyer/project',
      baseCommit: base,
      summary: 'A shop',
      createdAt: at,
      capMinor: 2000,
      currency: 'USD',
      version: 1,
      status: 'DRAFT',
      termsProof: null,
      milestones: ['one', 'two'].map((id, i) => {
        const bundle = tests.filter((t) => t.milestoneId === id);
        return {
          id,
          name: id,
          budgetMinor: 1000,
          deadline: at + 7 * 86400000,
          profileId: i === 1 ? ('code.final@1' as const) : ('code.milestone@1' as const),
          testBundleHash: hash(bundle.map((t) => ({ path: t.path, content: t.content }))),
          manifestHash: hash(bundle.map((t) => ({ id: t.id, path: t.path }))),
          testIds: bundle.map((t) => t.id),
        };
      }),
    },
  } as Plan;
}
// Stood's baselines, idempotent per key like the real API: queued until `run` says how each test went.
function stood() {
  const baselines = new Map<string, BaselineView>();
  const requests: { input: BaselineInput; key: string }[] = [];
  return {
    requests,
    run(result: (testId: string) => 'PASS' | 'FAIL' | 'INVALID') {
      for (const [key, v] of baselines) {
        const statuses = (requests.find((r) => r.key === key)?.input.testIds ?? []).map((id) => ({
          id,
          status: result(id),
        }));
        baselines.set(
          key,
          statuses.some((s) => s.status === 'INVALID')
            ? { ...v, status: 'INVALID' }
            : {
                ...v,
                status: 'DONE',
                tests: statuses as { id: string; status: 'PASS' | 'FAIL' }[],
                evidenceSha256: 'e'.repeat(64),
              },
        );
      }
    },
    client: {
      async requestBaseline(input: BaselineInput, key: string) {
        requests.push({ input, key });
        const existing = baselines.get(key);
        if (existing) return existing;
        const view: BaselineView = {
          id: `bl_${baselines.size + 1}`,
          status: 'QUEUED',
          repository: input.repository,
          baseCommit: input.baseCommit,
          testBundleHash: input.testBundleHash,
          tests: null,
          evidenceSha256: null,
        };
        baselines.set(key, view);
        return view;
      },
    },
  };
}
async function harness(status?: Plan['status']) {
  const repositories = new FakeRepositories(() => at, [{ id: '42', owner: 'buyer' }]);
  const { commit: base } = await repositories.create('42', 'project', { 'README.md': 'shop' });
  const events = new MemoryEvents();
  const board = new Board(events, { maxActiveClaims: 10 });
  const s = stood();
  const deps = {
    plans: {
      read: async (id: string) => (id === 'plan-1' ? plan(base, status) : Promise.reject(new Error('missing'))),
    },
    repositories,
    installation: '42',
    board,
    stood: s.client,
  };
  const read = await repositories.issue('42', 'buyer/project', 'READ');
  return { deps, s, board, repositories, base, read };
}

// C4 (#77): an accepted plan becomes a frozen Board blueprint only after Stood's runner shows every frozen test red.
describe('planBlueprint', () => {
  it('seeds the tests onto main, creates the blueprint at that commit and freezes it once every test failed', async () => {
    const h = await harness();
    const first = await planBlueprint('plan-1', buyer, h.deps);
    expect(first).toMatchObject({ blueprintId: 'shop', status: 'BASELINE_RUNNING' });
    const main = await h.repositories.head(h.read.value, 'buyer/project', 'main');
    expect(first.baseCommit).toBe(main);
    expect(main).not.toBe(h.base);
    expect(await h.repositories.read(h.read.value, 'buyer/project', main, 'tests/books.test.js')).toBe('test books');
    expect(h.s.requests.map((r) => r.key)).toEqual(['yard-baseline:shop:one', 'yard-baseline:shop:two']);
    expect(h.s.requests[0]?.input).toMatchObject({
      baseCommit: main,
      tests: [{ id: 'books', path: 'tests/books.test.js' }],
    });
    // Repeating while Stood is still running changes nothing.
    expect(await planBlueprint('plan-1', buyer, h.deps)).toEqual(first);
    h.s.run(() => 'FAIL');
    const frozen = await planBlueprint('plan-1', buyer, h.deps);
    expect(frozen.status).toBe('FROZEN');
    const blueprint = (await h.board.read('shop', buyer)).data as {
      blueprint: {
        status: string;
        baseCommit: string;
        termsProof: { baselines: { reference: string; failedTestIds: string[] }[] };
      };
    };
    expect(blueprint.blueprint).toMatchObject({ status: 'FROZEN', baseCommit: main });
    expect(blueprint.blueprint.termsProof.baselines[0]).toEqual(
      expect.objectContaining({ failedTestIds: ['books'], reference: `stood-baseline:bl_1:${'e'.repeat(64)}` }),
    );
    expect((await planBlueprint('plan-1', buyer, h.deps)).status).toBe('FROZEN');
  });

  it('sends the plan back when a frozen test already passes or is not at the base, and never freezes', async () => {
    for (const outcome of ['PASS', 'INVALID'] as const) {
      const h = await harness();
      await planBlueprint('plan-1', buyer, h.deps);
      h.s.run((id) => (id === 'pays' ? outcome : 'FAIL'));
      const result = await planBlueprint('plan-1', buyer, h.deps);
      expect(result.status).toBe('NEEDS_REVISION');
      expect(result.milestones.find((m) => m.id === 'two')).toMatchObject(
        outcome === 'PASS' ? { baseline: 'DONE', passing: ['pays'] } : { baseline: 'INVALID' },
      );
      expect(((await h.board.read('shop', buyer)).data as { blueprint: { status: string } }).blueprint.status).toBe(
        'DRAFT',
      );
    }
  });

  it('refuses another operator, an unaccepted plan and a missing plan before writing anything', async () => {
    const h = await harness();
    await expect(planBlueprint('plan-1', { ...buyer, id: 'someone' }, h.deps)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(planBlueprint('plan-1', { ...buyer, kind: 'BUILDER' }, h.deps)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(planBlueprint('nope', buyer, h.deps)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await h.repositories.head(h.read.value, 'buyer/project', 'main')).toBe(h.base);
    const review = await harness('BUYER_REVIEW');
    await expect(planBlueprint('plan-1', buyer, review.deps)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('refuses when main moved after the plan was made', async () => {
    const h = await harness();
    const build = await h.repositories.issue('42', 'buyer/project', 'BUILD', 'wo/early');
    const pushed = await h.repositories.push(build.value, 'buyer/project', 'wo/early', h.base, { 'src/x.ts': 'x' });
    const maintain = await h.repositories.issue('42', 'buyer/project', 'MAINTAIN');
    await h.repositories.merge(maintain.value, 'buyer/project', 'wo/early', pushed.commit, h.base);
    await expect(planBlueprint('plan-1', buyer, h.deps)).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
