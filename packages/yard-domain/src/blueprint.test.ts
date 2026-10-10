import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Blueprint, type BlueprintInput } from './blueprint.js';

const at = 1790985600000;
const milestone = (id: string, profileId: 'code.milestone@1' | 'code.final@1') => ({
  id,
  name: id,
  budgetMinor: 60000,
  deadline: at + 86400000,
  profileId,
  testBundleHash: 'a'.repeat(64),
  manifestHash: 'b'.repeat(64),
  testIds: ['accept_booking'],
});
const input: BlueprintInput = {
  id: 'bp_1',
  buyerOperatorId: 'buyer_1',
  repository: 'adaeze/bookings',
  baseCommit: 'c'.repeat(40),
  summary: 'Book a slot',
  createdAt: at,
  capMinor: 120000,
  currency: 'USD',
  milestones: [milestone('m1', 'code.milestone@1'), milestone('m2', 'code.final@1')],
};
const proof = () => ({
  version: 1,
  buyerOperatorId: 'buyer_1',
  approvalReference: 'approval_fixture',
  baselines: input.milestones.map((m) => ({
    milestoneId: m.id,
    testBundleHash: m.testBundleHash,
    manifestHash: m.manifestHash,
    failedTestIds: [...m.testIds],
    reference: 'red_fixture',
  })),
});
describe('Blueprint frozen terms, no payment signature (T-0177)', () => {
  it('keeps caller-owned objects separate and fixes final-only usage profiles', () => {
    const mutable = { ...input, milestones: input.milestones.map((m) => ({ ...m, testIds: [...m.testIds] })) };
    const bp = Blueprint.create(mutable);
    mutable.milestones[0]!.testIds.push('tamper');
    expect(bp.snapshot.milestones[0]?.testIds).toEqual(['accept_booking']);
    expect(Object.isFrozen(bp.snapshot.milestones[0]?.testIds)).toBe(true);
    expect(bp.snapshot.status).toBe('DRAFT');
  });
  it('edits draft versions and rejects stale or frozen updates without mutating history', () => {
    const draft = Blueprint.create(input);
    const edited = draft.edit(1, {
      summary: 'Revised booking',
      capMinor: input.capMinor,
      currency: input.currency,
      milestones: input.milestones,
    });
    expect(edited.snapshot.version).toBe(2);
    expect(draft.snapshot.summary).toBe('Book a slot');
    expect(() => edited.edit(1, input)).toThrow();
    const frozen = draft.freezeTerms(proof());
    expect(frozen.snapshot.status).toBe('FROZEN');
    expect(draft.snapshot.status).toBe('DRAFT');
    expect(() => frozen.edit(1, input)).toThrow();
    expect(() => frozen.freezeTerms(proof())).toThrow();
  });
  it('requires matching buyer approval and red proof for every signed test', () => {
    for (const patch of [
      { version: 2 },
      { buyerOperatorId: 'other' },
      { approvalReference: '' },
      { baselines: [] },
      { baselines: [...proof().baselines, proof().baselines[0]!] },
    ])
      expect(() => Blueprint.create(input).freezeTerms({ ...proof(), ...patch })).toThrow();
    for (const patch of [
      { milestoneId: 'unknown' },
      { testBundleHash: 'd'.repeat(64) },
      { manifestHash: 'd'.repeat(64) },
      { failedTestIds: [] },
      { failedTestIds: ['unknown'] },
      { reference: '' },
    ]) {
      const p = proof();
      p.baselines[0] = { ...p.baselines[0]!, ...patch };
      expect(() => Blueprint.create(input).freezeTerms(p)).toThrow();
    }
  });
  it('rejects malformed identity, budgets, hashes, tests and incompatible milestone profiles', () => {
    for (const patch of [
      { id: '' },
      { buyerOperatorId: '' },
      { repository: 'https://github.com/a/b' },
      { baseCommit: 'bad' },
      { summary: '' },
      { createdAt: NaN },
      { capMinor: 0 },
      { capMinor: 1.2 },
      { capMinor: Infinity },
      { currency: 'GHS' },
      { milestones: [] },
      { capMinor: 119999 },
    ])
      expect(() => Blueprint.create({ ...input, ...patch } as BlueprintInput)).toThrow();
    for (const patch of [
      { id: '' },
      { name: '' },
      { budgetMinor: 0 },
      { budgetMinor: NaN },
      { deadline: at - 1 },
      { deadline: Infinity },
      { testBundleHash: 'bad' },
      { manifestHash: 'bad' },
      { testIds: [] },
      { testIds: ['', 'a'] },
      { testIds: ['a', 'a'] },
      { profileId: 'code.final@1' },
    ])
      expect(() =>
        Blueprint.create({
          ...input,
          milestones: [
            { ...input.milestones[0]!, ...patch } as BlueprintInput['milestones'][number],
            input.milestones[1]!,
          ],
        }),
      ).toThrow();
    expect(() =>
      Blueprint.create({ ...input, milestones: [input.milestones[0]!, { ...input.milestones[1]!, id: 'm1' }] }),
    ).toThrow();
    expect(() =>
      Blueprint.create({
        ...input,
        milestones: [input.milestones[0]!, { ...input.milestones[1]!, profileId: 'code.milestone@1' }],
      }),
    ).toThrow();
  });
  it('retains exact integer totals and final scoping for arbitrary milestone budgets', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 1000000 }), { minLength: 1, maxLength: 10 }), (budgets) => {
        const milestones = budgets.map((budgetMinor, i) => ({
          ...milestone(`m${i}`, i === budgets.length - 1 ? 'code.final@1' : 'code.milestone@1'),
          budgetMinor,
        }));
        const bp = Blueprint.create({ ...input, capMinor: budgets.reduce((a, b) => a + b, 0), milestones });
        expect(bp.snapshot.milestones.reduce((a, b) => a + BigInt(b.budgetMinor), 0n)).toBe(
          BigInt(bp.snapshot.capMinor),
        );
        expect(bp.snapshot.milestones.filter((m) => m.profileId === 'code.final@1')).toHaveLength(1);
      }),
      { numRuns: 500 },
    );
  });
});

// T-0159: a milestone may carry its frozen test manifest ({id, path}, sorted by path) so Stood can bind the runner
// to it. Yard checks its shape and agreement with the test ids; Stood checks it against the manifest hash.
describe('Milestone test manifest', () => {
  const withTests = (tests: unknown) => ({
    ...input,
    milestones: [{ ...milestone('m1', 'code.milestone@1'), tests }, milestone('m2', 'code.final@1')],
  });
  it('keeps a manifest that agrees with the test ids, and works without one', () => {
    const tests = [{ id: 'accept_booking', path: 'tests/booking.test.js' }];
    expect(Blueprint.create(withTests(tests) as BlueprintInput).snapshot.milestones[0]?.tests).toEqual(tests);
    expect(Blueprint.create(input).snapshot.milestones[0]?.tests).toBeUndefined();
  });
  it('refuses a manifest that disagrees with the ids, is unsorted or unsafe, or repeats a path', () => {
    for (const tests of [
      [],
      [{ id: 'other', path: 'tests/a.test.js' }],
      [{ id: 'accept_booking', path: '../escape.js' }],
      [{ id: 'accept_booking', path: '/abs.js' }],
      [{ id: 'accept_booking', path: '' }],
      [{ id: 'accept_booking', path: 'tests\\win.js' }],
      [{ id: 'accept_booking', path: `tests/${'x'.repeat(400)}` }],
      [{ id: 'accept_booking', path: 'tests/./a.js' }],
      [{ id: 'accept_booking', path: 7 }],
      [null],
      [{ id: 'accept_booking', path: 'tests/a.test.js', extra: 1 }],
      [
        { id: 'accept_booking', path: 'tests/b.test.js' },
        { id: 'second', path: 'tests/a.test.js' },
      ],
      'not a list',
    ])
      expect(() => Blueprint.create(withTests(tests) as BlueprintInput)).toThrow('Invalid milestone');
    const two = {
      ...input,
      milestones: [
        {
          ...milestone('m1', 'code.milestone@1'),
          testIds: ['a', 'b'],
          tests: [
            { id: 'a', path: 'tests/a.test.js' },
            { id: 'b', path: 'tests/a.test.js' },
          ],
        },
        milestone('m2', 'code.final@1'),
      ],
    };
    expect(() => Blueprint.create(two as BlueprintInput)).toThrow('Invalid milestone');
  });
});
