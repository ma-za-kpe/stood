export type EditableTest = { id: string; path: string; content: string };
export type EditableDraft = {
  summary: string;
  requirements: { id: string; text: string; testIds: string[] }[];
  risks: string[];
  milestones: { id: string; name: string; budgetMinor: number; deadline: number; tests: EditableTest[] }[];
};
export function mergeMilestones(draft: EditableDraft, index: number): EditableDraft {
  const next = structuredClone(draft),
    a = next.milestones[index],
    b = next.milestones[index + 1];
  if (!Number.isSafeInteger(index) || index < 0 || !a || !b || next.milestones.length <= 3)
    throw new Error('Keep at least three milestones.');
  for (const test of b.tests) {
    const prior = a.tests.find((t) => t.path === test.path || t.id === test.id);
    if (prior && (prior.path !== test.path || prior.id !== test.id || prior.content !== test.content))
      throw new Error('Resolve conflicting tests before merging.');
    if (!prior) a.tests.push(test);
  }
  if (!Number.isSafeInteger(a.budgetMinor + b.budgetMinor)) throw new Error('Invalid milestone budget.');
  a.budgetMinor += b.budgetMinor;
  a.deadline = Math.max(a.deadline, b.deadline);
  a.name = `${a.name} / ${b.name}`;
  next.milestones.splice(index + 1, 1);
  return next;
}
export function splitMilestone(draft: EditableDraft, index: number): EditableDraft {
  const next = structuredClone(draft),
    a = next.milestones[index];
  if (
    !Number.isSafeInteger(index) ||
    index < 0 ||
    !a ||
    a.tests.length < 2 ||
    a.budgetMinor < 2 ||
    next.milestones.length >= 6
  )
    throw new Error('Splitting needs two tests, two minor units and fewer than six milestones.');
  let suffix = 1,
    id = `${a.id.slice(0, 85)}_split${suffix}`;
  while (next.milestones.some((m) => m.id === id)) id = `${a.id.slice(0, 85)}_split${++suffix}`;
  const budgetMinor = Math.floor(a.budgetMinor / 2);
  const b = { ...a, id, name: `${a.name} / part 2`, budgetMinor, tests: a.tests.splice(Math.ceil(a.tests.length / 2)) };
  a.budgetMinor -= budgetMinor;
  next.milestones.splice(index + 1, 0, b);
  return next;
}
