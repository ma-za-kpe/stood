import { type CostLine, checkedCostLines, costDisclosure } from './pricing.js';

export type Milestone = Readonly<{
  id: string;
  name: string;
  budgetMinor: number;
  deadline: number;
  profileId: 'code.milestone@1' | 'code.final@1';
  testBundleHash: string;
  manifestHash: string;
  testIds: readonly string[];
  // T-0159: the frozen manifest ({id, path}, sorted by path) that manifestHash covers, when the plan provides it.
  tests?: readonly Readonly<{ id: string; path: string }>[];
}>;
export type BlueprintInput = Readonly<{
  id: string;
  buyerOperatorId: string;
  repository: string;
  baseCommit: string;
  summary: string;
  createdAt: number;
  capMinor: number;
  currency: string;
  milestones: readonly Milestone[];
  costLines?: readonly CostLine[];
}>;
type Terms = Pick<BlueprintInput, 'summary' | 'capMinor' | 'currency' | 'milestones'>;
export type FreezeProof = Readonly<{
  version: number;
  buyerOperatorId: string;
  approvalReference: string;
  baselines: readonly Readonly<{
    milestoneId: string;
    testBundleHash: string;
    manifestHash: string;
    failedTestIds: readonly string[];
    reference: string;
  }>[];
}>;
type Snapshot = BlueprintInput &
  Readonly<{ version: number; status: 'DRAFT' | 'FROZEN'; termsProof: FreezeProof | null }>;
const text = (s: string) => typeof s === 'string' && s.trim().length > 0 && s.length <= 1024;
const hash = (s: string) => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
const safePath = (p: unknown) =>
  typeof p === 'string' &&
  p.length > 0 &&
  p.length <= 400 &&
  !p.startsWith('/') &&
  !/[\\\0]/.test(p) &&
  p.split('/').every((part) => part && part !== '.' && part !== '..');
// The manifest must list exactly the test ids, in order, with safe, unique paths sorted as the Foreman froze them.
function manifest(tests: unknown, ids: readonly string[]) {
  if (
    !Array.isArray(tests) ||
    tests.length !== ids.length ||
    !tests.every(
      (t, i) =>
        t &&
        typeof t === 'object' &&
        Object.keys(t).sort().join() === 'id,path' &&
        t.id === ids[i] &&
        safePath(t.path) &&
        (i === 0 || tests[i - 1].path.localeCompare(t.path) < 0),
    )
  )
    throw new RangeError('Invalid milestone');
  return Object.freeze(tests.map((t: { id: string; path: string }) => Object.freeze({ id: t.id, path: t.path })));
}
function checked(input: BlueprintInput): BlueprintInput {
  if (
    !text(input.id) ||
    !text(input.buyerOperatorId) ||
    !text(input.summary) ||
    !/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(input.repository) ||
    !/^[a-f0-9]{40}$/.test(input.baseCommit) ||
    !Number.isSafeInteger(input.createdAt) ||
    !Number.isSafeInteger(input.capMinor) ||
    input.capMinor <= 0 ||
    !['USD', 'GBP', 'EUR'].includes(input.currency) ||
    !input.milestones.length ||
    input.milestones.length > 100
  )
    throw new RangeError('Invalid blueprint');
  const milestones = input.milestones.map((m, i) => {
    if (
      !text(m.id) ||
      !text(m.name) ||
      !Number.isSafeInteger(m.budgetMinor) ||
      m.budgetMinor <= 0 ||
      !Number.isSafeInteger(m.deadline) ||
      m.deadline < input.createdAt ||
      !hash(m.testBundleHash) ||
      !hash(m.manifestHash) ||
      !m.testIds.length ||
      !m.testIds.every(text) ||
      new Set(m.testIds).size !== m.testIds.length ||
      m.profileId !== (i === input.milestones.length - 1 ? 'code.final@1' : 'code.milestone@1')
    )
      throw new RangeError('Invalid milestone');
    return Object.freeze({
      id: m.id,
      name: m.name,
      budgetMinor: m.budgetMinor,
      deadline: m.deadline,
      profileId: m.profileId,
      testBundleHash: m.testBundleHash,
      manifestHash: m.manifestHash,
      testIds: Object.freeze([...m.testIds]),
      ...(m.tests === undefined ? {} : { tests: manifest(m.tests, m.testIds) }),
    });
  });
  if (new Set(milestones.map((m) => m.id)).size !== milestones.length)
    throw new RangeError('Invalid milestone total or identity');
  const costLines = checkedCostLines(input.costLines);
  costDisclosure({ capMinor: input.capMinor, currency: input.currency, milestones }, costLines);
  return Object.freeze({
    id: input.id,
    buyerOperatorId: input.buyerOperatorId,
    repository: input.repository,
    baseCommit: input.baseCommit,
    summary: input.summary,
    createdAt: input.createdAt,
    capMinor: input.capMinor,
    currency: input.currency,
    milestones: Object.freeze(milestones),
    costLines,
  });
}
// FROZEN is a local terms record, never a PayPal mandate or Stood payment state.
export class Blueprint {
  private constructor(readonly snapshot: Snapshot) {
    Object.freeze(this);
  }
  static create(input: BlueprintInput): Blueprint {
    return new Blueprint(Object.freeze({ ...checked(input), version: 1, status: 'DRAFT', termsProof: null }));
  }
  edit(expectedVersion: number, terms: Terms): Blueprint {
    if (this.snapshot.status !== 'DRAFT' || expectedVersion !== this.snapshot.version)
      throw new Error('Frozen or stale blueprint');
    return new Blueprint(
      Object.freeze({
        ...checked({
          ...this.snapshot,
          summary: terms.summary,
          capMinor: terms.capMinor,
          currency: terms.currency,
          milestones: terms.milestones,
        }),
        version: expectedVersion + 1,
        status: 'DRAFT',
        termsProof: null,
      }),
    );
  }
  freezeTerms(proof: FreezeProof): Blueprint {
    const s = this.snapshot;
    if (
      s.status !== 'DRAFT' ||
      proof.version !== s.version ||
      proof.buyerOperatorId !== s.buyerOperatorId ||
      !text(proof.approvalReference) ||
      proof.baselines.length !== s.milestones.length
    )
      throw new Error('Unapproved blueprint terms');
    const baselines = proof.baselines.map((p, i) => {
      const m = s.milestones[i]!;
      if (
        p.milestoneId !== m.id ||
        p.testBundleHash !== m.testBundleHash ||
        p.manifestHash !== m.manifestHash ||
        !text(p.reference) ||
        p.failedTestIds.length !== m.testIds.length ||
        new Set(p.failedTestIds).size !== p.failedTestIds.length ||
        !p.failedTestIds.every((id) => m.testIds.includes(id))
      )
        throw new Error('Missing matching red baseline');
      return Object.freeze({
        milestoneId: p.milestoneId,
        testBundleHash: p.testBundleHash,
        manifestHash: p.manifestHash,
        reference: p.reference,
        failedTestIds: Object.freeze([...p.failedTestIds]),
      });
    });
    return new Blueprint(
      Object.freeze({
        ...s,
        status: 'FROZEN',
        termsProof: Object.freeze({
          version: proof.version,
          buyerOperatorId: proof.buyerOperatorId,
          approvalReference: proof.approvalReference,
          baselines: Object.freeze(baselines),
        }),
      }),
    );
  }
}
