import type { BaselineInput, BaselineView } from '@stood/stood-sdk';
import type { Blueprint, BlueprintInput, FreezeProof, Plan } from '@stood/yard-domain';
import { YardError, type YardSnapshot } from '../ports/events.js';
import type { ForemanPlans } from '../ports/foreman.js';
import type { Repositories } from '../ports/repositories.js';
import type { Operator } from './board.js';

type Deps = Readonly<{
  plans: Pick<ForemanPlans, 'read'>;
  repositories: Pick<Repositories, 'issue' | 'seedTests'>;
  // The Yard GitHub App installation that holds the buyer's repository.
  installation: string;
  board: Readonly<{
    create(input: BlueprintInput, actor: Operator, key: string): Promise<YardSnapshot>;
    read(id: string, actor: Operator): Promise<YardSnapshot>;
    freeze(id: string, proof: FreezeProof, actor: Operator, version: number, key: string): Promise<unknown>;
  }>;
  stood: Readonly<{ requestBaseline(input: BaselineInput, key: string): Promise<BaselineView> }>;
}>;
export type PlanBlueprint = Readonly<{
  blueprintId: string;
  baseCommit: string;
  // BASELINE_RUNNING until Stood has run every milestone; FROZEN once all frozen tests failed on the base;
  // NEEDS_REVISION when a test already passes (or is not at the base), so it cannot prove new work.
  status: 'BASELINE_RUNNING' | 'FROZEN' | 'NEEDS_REVISION';
  milestones: readonly Readonly<{
    id: string;
    baseline: BaselineView['status'];
    passing: readonly string[];
  }>[];
}>;

const blueprintOf = (snapshot: YardSnapshot) => (snapshot.data as { blueprint: Blueprint['snapshot'] }).blueprint;

// C4 (#77): turns a plan the buyer accepted into a frozen Board blueprint. Each step is idempotent, so the buyer
// (or a retry after a lost reply) calls this until it is FROZEN:
// 1. Yard seeds the plan's frozen tests onto main as one fast-forward commit, the new base commit.
// 2. The Board blueprint is created from the plan at that commit, with each milestone's test manifest.
// 3. Stood runs each milestone's tests on the base commit in its isolated runner (a baseline).
// 4. Only when every frozen test failed there is the blueprint frozen, with Stood's evidence as the proof.
export async function planBlueprint(planId: string, actor: Operator, deps: Deps): Promise<PlanBlueprint> {
  let plan: Plan;
  try {
    plan = await deps.plans.read(planId);
  } catch {
    throw new YardError('NOT_FOUND');
  }
  if (actor.kind !== 'BUYER' || plan.blueprint.buyerOperatorId !== actor.id) throw new YardError('FORBIDDEN');
  if (plan.status !== 'READY_FOR_BASELINE') throw new YardError('CONFLICT');
  const { version: _version, status: _status, termsProof: _proof, ...draft } = plan.blueprint;
  const files = Object.fromEntries(plan.tests.map((t) => [t.path, t.content]));
  const token = await deps.repositories.issue(deps.installation, draft.repository, 'MAINTAIN');
  const { commit: baseCommit } = await deps.repositories.seedTests(
    token.value,
    draft.repository,
    draft.baseCommit,
    files,
  );
  const input: BlueprintInput = {
    ...draft,
    baseCommit,
    milestones: draft.milestones.map((m) => ({
      ...m,
      tests: plan.tests
        .filter((t) => t.milestoneId === m.id)
        .map((t) => ({ id: t.id, path: t.path }))
        .sort((a, b) => a.path.localeCompare(b.path)),
    })),
  };
  let snapshot: YardSnapshot;
  try {
    snapshot = await deps.board.read(draft.id, actor);
  } catch (error) {
    if (!(error instanceof YardError) || error.code !== 'NOT_FOUND') throw error;
    snapshot = await deps.board.create(input, actor, `yard-plan:${planId}:v${plan.version}`);
  }
  const blueprint = blueprintOf(snapshot);
  // An existing blueprint must be this plan at this base; anything else is someone else's terms.
  if (blueprint.baseCommit !== baseCommit || blueprint.repository !== draft.repository) throw new YardError('CONFLICT');
  const runs = await Promise.all(
    input.milestones.map(async (m) => ({
      milestone: m,
      view: await deps.stood.requestBaseline(
        {
          repository: input.repository,
          baseCommit,
          testBundleHash: m.testBundleHash,
          manifestHash: m.manifestHash,
          testIds: [...m.testIds],
          tests: [...(m.tests ?? [])],
        },
        `yard-baseline:${draft.id}:${m.id}`,
      ),
    })),
  );
  const milestones = runs.map(({ milestone, view }) => ({
    id: milestone.id,
    baseline: view.status,
    passing: (view.tests ?? []).filter((t) => t.status === 'PASS').map((t) => t.id),
  }));
  const result = (status: PlanBlueprint['status']) => ({ blueprintId: draft.id, baseCommit, status, milestones });
  if (blueprint.status === 'FROZEN') return result('FROZEN');
  if (milestones.some((m) => m.baseline === 'INVALID' || m.passing.length)) return result('NEEDS_REVISION');
  if (milestones.some((m) => m.baseline !== 'DONE')) return result('BASELINE_RUNNING');
  await deps.board.freeze(
    draft.id,
    {
      version: blueprint.version,
      buyerOperatorId: actor.id,
      approvalReference: `foreman-plan:${planId}:v${plan.version}`,
      baselines: runs.map(({ milestone, view }) => ({
        milestoneId: milestone.id,
        testBundleHash: milestone.testBundleHash,
        manifestHash: milestone.manifestHash,
        failedTestIds: (view.tests ?? []).map((t) => t.id),
        reference: `stood-baseline:${view.id}:${view.evidenceSha256}`,
      })),
    },
    actor,
    snapshot.version,
    `yard-freeze:${draft.id}`,
  );
  return result('FROZEN');
}
