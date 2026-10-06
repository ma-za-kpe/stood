import type { PlannerModel } from '../../src/foreman.js';
// Scripted model fixture: no AI provider, network, keys, execution or tools.
export class ScriptedPlannerModel implements PlannerModel {
  constructor(environment: string) {
    if (!['local', 'ci', 'demo'].includes(environment)) throw new Error('Scripted planner refused');
  }
  async draft({ intake, revision }: Parameters<PlannerModel['draft']>[0]) {
    const base = Math.floor(intake.capMinor / 3);
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
        deadline: intake.createdAt + (i + 1) * 7 * 86400000,
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
