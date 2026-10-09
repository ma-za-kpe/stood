import { expect, it } from 'vitest';
import { type EditableDraft, mergeMilestones, splitMilestone } from './blueprint-edit.js';

const fixture = (): EditableDraft => ({
  summary: 'Booking app',
  risks: [],
  requirements: [{ id: 'book', text: 'Can book', testIds: ['a', 'b'] }],
  milestones: [1, 2, 3, 4].map((i) => ({
    id: `m${i}`,
    name: `Stage ${i}`,
    budgetMinor: 1001,
    deadline: 1791244800000,
    tests: [
      { id: 'a', path: 'tests/a.test.ts', content: 'expect(a()).toBe(true);' },
      { id: 'b', path: 'tests/b.test.ts', content: 'expect(b()).toBe(true);' },
    ],
  })),
});
it('merges compatible test bundles and preserves the cap, requirement mapping and original draft', () => {
  const original = fixture();
  const next = mergeMilestones(original, 0);
  expect(next.milestones).toHaveLength(3);
  expect(next.milestones[0]).toMatchObject({ budgetMinor: 2002, tests: original.milestones[0]!.tests });
  expect(next.requirements).toEqual(original.requirements);
  expect(original.milestones).toHaveLength(4);
  expect(() => mergeMilestones(next, 0)).toThrow();
  const conflict = fixture();
  conflict.milestones[1]!.tests[0]!.content = 'Different';
  expect(() => mergeMilestones(conflict, 0)).toThrow();
});
it('splits real tests between distinct milestones without losing a cent or inventing acceptance tests', () => {
  const original = fixture();
  const next = splitMilestone(original, 1);
  expect(next.milestones).toHaveLength(5);
  expect(next.milestones[1]!.tests).toHaveLength(1);
  expect(next.milestones[2]!.tests).toHaveLength(1);
  expect(next.milestones[1]!.budgetMinor + next.milestones[2]!.budgetMinor).toBe(1001);
  expect(new Set(next.milestones.map((m) => m.id)).size).toBe(5);
  expect(next.requirements).toEqual(original.requirements);
  expect(() => splitMilestone(next, 1)).toThrow();
  expect(() => splitMilestone(original, -1)).toThrow();
});
it('refuses merges that would overflow the budget or mix tests that share an id but not a path (T-0275)', () => {
  const huge = fixture();
  huge.milestones[0]!.budgetMinor = Number.MAX_SAFE_INTEGER;
  expect(() => mergeMilestones(huge, 0)).toThrow('Invalid milestone budget.');
  const mixed = fixture();
  mixed.milestones[1]!.tests[0]!.path = 'tests/renamed.test.ts';
  expect(() => mergeMilestones(mixed, 0)).toThrow('Resolve conflicting tests before merging.');
  expect(() => mergeMilestones(fixture(), 3)).toThrow('Keep at least three milestones.');
});
it('brings tests the first milestone lacks into a merge (T-0275)', () => {
  const draft = fixture();
  draft.milestones[1]!.tests.push({ id: 'c', path: 'tests/c.test.ts', content: 'expect(c()).toBe(true);' });
  expect(mergeMilestones(draft, 0).milestones[0]?.tests.map((t) => t.id)).toEqual(['a', 'b', 'c']);
});
