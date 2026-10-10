import type { Plan, PlannerIntake } from '@stood/yard-domain';
export interface ForemanPlans {
  draft(input: PlannerIntake): Promise<Plan>;
  read(id: string): Promise<Plan>;
  recover(id: string, buyer: string): Promise<Plan>;
  resume(id: string, buyer: string, version: number, decision: 'ACCEPT' | 'REVISE'): Promise<Plan>;
  edit(id: string, buyer: string, version: number, key: string, draft: unknown): Promise<Plan>;
  revise(id: string, buyer: string, version: number, feedback: string): Promise<Plan>;
  // T-0217: delete what the planner kept for an erased intake.
  forget?(id: string): Promise<void>;
}
