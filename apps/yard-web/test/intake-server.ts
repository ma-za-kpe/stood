// T-0275: a scripted intake and planning service for IntakePanel tests. It enforces If-Match versions like the real one.
import { intakeFixture } from '../../../packages/yard-contracts/test/fakes/intake.js';
import type { Call } from './harness.js';

export const T = Date.parse('2026-10-05T00:00:00Z');
export function completeDraft() {
  const draft = structuredClone(intakeFixture(T)) as { handover: Record<string, unknown> };
  delete draft.handover.baseCommit;
  return draft;
}
export const plan = (status = 'BUYER_REVIEW', version = 1) => ({
  status,
  version,
  simulated: true,
  intakeContext: 'context',
  blueprint: {
    id: 'bp1',
    summary: 'A booking app for a salon',
    currency: 'USD',
    capMinor: 3003,
    milestones: [1, 2, 3].map((i) => ({
      id: `m${i}`,
      name: `Stage ${i}`,
      budgetMinor: 1001,
      deadline: T + i * 86400000,
    })),
  },
  tests: [1, 2, 3].flatMap((i) => [
    { milestoneId: `m${i}`, id: 'a', path: 'tests/a.test.ts', content: 'expect(a()).toBe(true);' },
    { milestoneId: `m${i}`, id: 'b', path: 'tests/b.test.ts', content: 'expect(b()).toBe(true);' },
  ]),
  requirements: [{ id: 'book', text: 'Can book', testIds: ['a', 'b'] }],
  risks: ['Payments are simulated until qualified'],
});

// C4 (#77): a blueprint progress reply for the accepted plan bp1.
export const progress = (status: string, milestones: { baseline: string; passing?: string[] }[]) => ({
  blueprintId: 'bp1',
  baseCommit: 'c0ffee'.padEnd(40, '0'),
  status,
  milestones: milestones.map((m, i) => ({ id: `m${i + 1}`, passing: [], ...m })),
});

export function intakeServer(initial: { draft?: unknown; step?: number } = {}) {
  const state = {
    record: null as null | {
      id: string;
      owner: string;
      version: number;
      step: number;
      draft: unknown;
      createdAt: number;
      updatedAt: number;
    },
    plan: plan(),
    failPut: 0 as number,
    failPlan: false,
    // C4 (#77): what successive blueprint calls return; empty means the service is unavailable.
    baselines: [] as unknown[],
    eraseStatus: 0 as number,
  };
  const reply = (call: Call) => {
    if (call.path === '/research/ideas')
      return {
        body: {
          items: [],
          attribution: {
            required: true,
            text: 'Research by StartupTribunal',
            url: 'https://startuptribunal.com/catalog',
          },
        },
      };
    if (call.method === 'POST' && call.path === '/intakes') {
      const body = JSON.parse(call.body);
      state.record = {
        id: body.id,
        owner: 'buyer',
        version: 1,
        step: initial.step ?? 0,
        draft: initial.draft ?? body.draft,
        createdAt: T,
        updatedAt: T,
      };
      return { body: state.record };
    }
    const intake = /^\/intakes\/([^/]+)(\/plan)?$/.exec(call.path);
    if (intake && call.method === 'GET')
      return state.record && state.record.id === intake[1] ? { body: state.record } : { status: 404 };
    if (intake && call.method === 'PUT') {
      if (state.failPut) return { status: state.failPut };
      if (!state.record || call.headers.get('If-Match') !== String(state.record.version)) return { status: 409 };
      const body = JSON.parse(call.body);
      state.record = {
        ...state.record,
        version: state.record.version + 1,
        step: body.step,
        draft: body.draft,
        updatedAt: T + 1000,
      };
      return { body: state.record };
    }
    if (intake?.[2] && call.method === 'POST') return state.failPlan ? { status: 503 } : { body: state.plan };
    if (call.path === '/plans/bp1/edits') {
      const edited = JSON.parse(call.body);
      state.plan = {
        ...state.plan,
        version: state.plan.version + 1,
        blueprint: { ...state.plan.blueprint, summary: edited.summary },
      };
      return { body: state.plan };
    }
    if (call.path === '/plans/bp1' && call.method === 'GET') return { body: state.plan };
    if (call.path === '/plans/bp1/review') {
      const { decision } = JSON.parse(call.body);
      state.plan = plan(decision === 'ACCEPT' ? 'READY_FOR_BASELINE' : 'REVISION_REQUESTED', state.plan.version + 1);
      return { body: state.plan };
    }
    // T-0217: the owner erases the intake; a project made from it is kept (409).
    if (intake && call.method === 'DELETE') {
      if (state.eraseStatus) return { status: state.eraseStatus };
      state.record = null;
      return { body: { id: intake[1], erased: true, already: false } };
    }
    if (call.path === '/plans/bp1/blueprint' && call.method === 'POST') {
      const next = state.baselines.shift();
      return next ? { body: next } : { status: 503 };
    }
    if (call.path === '/plans/bp1/revisions') {
      state.plan = plan('BUYER_REVIEW', state.plan.version + 1);
      return { body: state.plan };
    }
    return { status: 404 };
  };
  return { state, reply };
}
