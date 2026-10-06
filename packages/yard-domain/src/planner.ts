import type { Blueprint, BlueprintInput } from './blueprint.js';
export type PlannerIntake = Omit<BlueprintInput, 'summary' | 'milestones'> &
  Readonly<{ description: string; context?: string }>;
export type Plan = Readonly<{
  status: 'BUYER_REVIEW' | 'READY_FOR_BASELINE' | 'REVISION_REQUESTED';
  blueprint: Blueprint['snapshot'];
  requirements: readonly Readonly<{ id: string; text: string; testIds: readonly string[] }>[];
  tests: readonly Readonly<{ milestoneId: string; id: string; path: string; content: string }>[];
  risks: readonly string[];
  version: number;
  simulated: boolean;
  intakeContext?: string;
}>;
export type PlannerErrorCode = 'INVALID' | 'FORBIDDEN' | 'CONFLICT' | 'NOT_FOUND' | 'INVALID_DRAFT';
