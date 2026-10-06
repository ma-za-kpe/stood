import { completeIntakeChecked } from '@stood/yard-contracts';
import type { PlannerModel } from '../../src/foreman.js';
// Scripted model fixture: no AI provider, network, keys, execution or tools.
export class ScriptedPlannerModel implements PlannerModel {
  constructor(environment: string) {
    if (!['local', 'ci', 'demo'].includes(environment)) throw new Error('Scripted planner refused');
  }
  async draft({ intake, revision }: Parameters<PlannerModel['draft']>[0]) {
    const base = Math.floor(intake.capMinor / 3);
    const deadline =
      intake.context === undefined
        ? intake.createdAt + 21 * 86400000
        : completeIntakeChecked(JSON.parse(intake.context), intake.createdAt).timing.deadline;
    const duration = BigInt(deadline) - BigInt(intake.createdAt);
    const milestoneDeadline = (index: number) => {
      const offset = (duration * BigInt(index + 1)) / 3n;
      return Number(BigInt(intake.createdAt) + (offset > 0n ? offset : 1n));
    };
    return {
      summary: `${intake.description.trim().slice(0, 600)}${revision ? ' — revised scope' : ''}`,
      requirements: ['Build', 'Preview', 'Handover'].map((name, i) => ({
        id: `requirement-${i + 1}`,
        text: `${name} the agreed product`,
        testIds: [`acceptance-${i + 1}`],
      })),
      risks: [
        'Scripted planner output. No AI provider was called.',
        'Baseline tests have not run; this draft cannot be signed or funded.',
      ],
      milestones: ['Build', 'Preview', 'Handover'].map((name, i) => ({
        id: `milestone-${i + 1}`,
        name,
        budgetMinor: i === 2 ? intake.capMinor - 2 * base : base,
        deadline: milestoneDeadline(i),
        tests: [
          {
            id: `acceptance-${i + 1}`,
            path: `tests/milestone-${i + 1}.test.js`,
            content: `import assert from 'node:assert/strict';\nimport { deliver } from '../src/app.js';\nassert.equal(await deliver(${i + 1}), true);\n`,
          },
        ],
      })),
    };
  }
}
