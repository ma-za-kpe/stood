import { plannerModelContract } from '../test/contracts/planner-model.js';
import { ScriptedPlannerModel } from '../test/fakes/model.js';
import { xaiServer } from '../test/fakes/xai.js';
import { GrokPlannerModel, MemorySpendGuard } from './adapters/grok/grok.js';

plannerModelContract('scripted', () => new ScriptedPlannerModel('ci'), { simulated: true });
// T-0221: the Grok adapter against a scripted xAI API, on every run.
plannerModelContract(
  'grok (scripted xAI API)',
  () =>
    new GrokPlannerModel({
      apiKey: 'contract-key',
      fetch: xaiServer().fetch,
      guard: new MemorySpendGuard(1_000_000, Date.now),
      log: () => undefined,
    }),
  { simulated: false },
);
// Live qualification against the real model, only on request (scripts/dev planner-check): it spends real credit.
if (process.env.GROK_PLANNER_LIVE === '1' && process.env.GROK_PLANNER_API_KEY)
  plannerModelContract(
    `grok live (${process.env.GROK_PLANNER_MODEL ?? 'grok-build-0.1'})`,
    () =>
      new GrokPlannerModel({
        apiKey: process.env.GROK_PLANNER_API_KEY ?? '',
        ...(process.env.GROK_PLANNER_MODEL ? { model: process.env.GROK_PLANNER_MODEL } : {}),
        guard: new MemorySpendGuard(200_000, Date.now),
        log: (entry) => process.stdout.write(`${JSON.stringify(entry)}\n`),
      }),
    { simulated: false, timeoutMs: 150_000 },
  );
