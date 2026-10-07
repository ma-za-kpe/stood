import { plannerModelContract } from '../test/contracts/planner-model.js';
import { ScriptedPlannerModel } from '../test/fakes/model.js';

// The live adapter joins this file after the credential handoff (issue #50, batch C3).
plannerModelContract('scripted', () => new ScriptedPlannerModel('ci'), { simulated: true });
