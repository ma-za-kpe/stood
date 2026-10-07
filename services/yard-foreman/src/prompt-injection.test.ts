import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { MemorySaver } from '../test/fakes/checkpoint.js';
import { ScriptedPlannerModel } from '../test/fakes/model.js';
import { Foreman, type PlannerIntake, type PlannerModel } from './foreman.js';

const corpus = JSON.parse(
  readFileSync(new URL('../test/scenarios/prompt-injection.json', import.meta.url), 'utf8'),
) as { id: string; text: string }[];
const intake: PlannerIntake = {
  id: 'injection',
  buyerOperatorId: 'buyer',
  repository: 'buyer/project',
  baseCommit: 'a'.repeat(40),
  description: 'Build bookings',
  capMinor: 3000,
  currency: 'USD',
  createdAt: 1791158400000,
};
it.each(corpus)('keeps $id as untrusted data with no action capabilities', async (attack) => {
  const fetch = vi.fn(() => {
    throw new Error('No network authority');
  });
  vi.stubGlobal('fetch', fetch);
  try {
    const source = new ScriptedPlannerModel('ci');
    const model = { draft: vi.fn(async (input: Parameters<PlannerModel['draft']>[0]) => source.draft(input)) };
    const f = new Foreman(model, new MemorySaver());
    const original = { ...intake, description: attack.text };
    const plan = await f.draft(original);
    const passed = model.draft.mock.calls[0]?.[0];
    expect(Object.keys(passed ?? {}).sort()).toEqual(['intake', 'policy']);
    expect(passed?.intake).toEqual(original);
    expect(passed?.policy).toContain('untrusted data');
    expect(plan.blueprint).toMatchObject({
      buyerOperatorId: 'buyer',
      repository: 'buyer/project',
      baseCommit: intake.baseCommit,
      capMinor: 3000,
      status: 'DRAFT',
      termsProof: null,
    });
    expect(plan.blueprint.milestones.map((m) => m.profileId)).toEqual([
      'code.milestone@1',
      'code.milestone@1',
      'code.final@1',
    ]);
    expect((await f.resume(intake.id, 'buyer', 1, 'ACCEPT')).status).toBe('READY_FOR_BASELINE');
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
it('refuses model-invented authority and financial scope before producing a review', async () => {
  const source = new ScriptedPlannerModel('ci');
  const output = await source.draft({ intake, policy: 'Draft only' });
  for (const value of [
    { ...output, status: 'PAID' },
    { ...output, buyerOperatorId: 'builder' },
    { ...output, tools: [{ name: 'capture' }] },
    { ...output, milestones: output.milestones.map((m) => ({ ...m, budgetMinor: 2000 })) },
    { ...output, milestones: output.milestones.map((m) => ({ ...m, profileId: 'code.milestone@1' })) },
    {
      ...output,
      milestones: output.milestones.map((m) => ({
        ...m,
        tests: m.tests.map((t) => ({ ...t, path: 'tests/../../signing-key.js' })),
      })),
    },
  ]) {
    const f = new Foreman({ draft: async () => value }, new MemorySaver());
    await expect(f.draft(intake)).rejects.toThrow('INVALID_DRAFT');
    await expect(f.read(intake.id)).rejects.toThrow('NOT_FOUND');
  }
});
it('refuses recognised keys in model output without returning or checkpointing their values', async () => {
  const source = new ScriptedPlannerModel('ci');
  const output = await source.draft({ intake, policy: 'Draft only' });
  const credential = ['client', 'secret'].join('_') + ' = synthetic-secret-value';
  for (const value of [
    { ...output, summary: credential },
    { ...output, risks: [credential] },
    {
      ...output,
      milestones: output.milestones.map((m) => ({ ...m, tests: m.tests.map((t) => ({ ...t, content: credential })) })),
    },
  ]) {
    const saver = new MemorySaver();
    const f = new Foreman({ draft: async () => value }, saver);
    await expect(f.draft(intake)).rejects.toThrow('INVALID_DRAFT');
    const checkpoint = await saver.getTuple({ configurable: { thread_id: intake.id } });
    expect(JSON.stringify(checkpoint)).not.toContain('synthetic-secret-value');
  }
});

it('does not let a model mutate its saved intake or recover as an invented buyer', async () => {
  let attempt = 0;
  const source = new ScriptedPlannerModel('ci');
  const model: PlannerModel = {
    draft: async (input) => {
      if (++attempt === 1)
        Object.assign(input.intake, { buyerOperatorId: 'builder', repository: 'builder/project', capMinor: 6000 });
      return source.draft(input);
    },
  };
  const f = new Foreman(model, new MemorySaver());
  await expect(f.draft(intake)).rejects.toThrow('INVALID_DRAFT');
  await expect(f.recover(intake.id, 'builder')).rejects.toThrow('FORBIDDEN');
  const plan = await f.recover(intake.id, 'buyer');
  expect(plan.blueprint).toMatchObject({
    buyerOperatorId: 'buyer',
    repository: 'buyer/project',
    capMinor: 3000,
    status: 'DRAFT',
    termsProof: null,
  });
  expect(intake).toMatchObject({ buyerOperatorId: 'buyer', repository: 'buyer/project', capMinor: 3000 });
});
it('keeps the original 64 KiB model boundary while scanning output for credentials', async () => {
  const source = new ScriptedPlannerModel('ci');
  const output = await source.draft({ intake, policy: 'Draft only' });
  output.risks = Array.from({ length: 13 }, () => 'x'.repeat(4000));
  const f = new Foreman({ draft: async () => output }, new MemorySaver());
  expect((await f.draft(intake)).risks).toHaveLength(13);
});
