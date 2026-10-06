import type { Plan, PlannerIntake } from '@stood/yard-domain';
export interface ForemanPlans {
  draft(input: PlannerIntake): Promise<Plan>;
  read(id: string): Promise<Plan>;
  recover(id: string, buyer: string): Promise<Plan>;
  resume(id: string, buyer: string, version: number, decision: 'ACCEPT' | 'REVISE'): Promise<Plan>;
  revise(id: string, buyer: string, version: number, feedback: string): Promise<Plan>;
}
