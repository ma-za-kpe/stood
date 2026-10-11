import type { Blueprint, BlueprintInput } from './blueprint.js';
export type PlannerIntake = Omit<BlueprintInput, 'summary' | 'milestones'> &
  Readonly<{ description: string; context?: string }>;
// Second audit (2026-10-11): an acceptance case (format stood.cases@1), data the Foreman writes and Yard renders into
// the frozen test file: run `node src/cli.js ...args` with `input`, expect the exit `status` and the `output`.
export type AcceptanceCase = Readonly<{
  name: string;
  args: readonly string[];
  input: string;
  status: number;
  output: string;
  match: 'exact' | 'includes';
}>;
export type Plan = Readonly<{
  status: 'BUYER_REVIEW' | 'READY_FOR_BASELINE' | 'REVISION_REQUESTED';
  blueprint: Blueprint['snapshot'];
  requirements: readonly Readonly<{ id: string; text: string; testIds: readonly string[] }>[];
  // content is the rendered test file; cases are what it was rendered from (absent on plans made before the format).
  tests: readonly Readonly<{
    milestoneId: string;
    id: string;
    path: string;
    content: string;
    cases?: readonly AcceptanceCase[];
  }>[];
  risks: readonly string[];
  version: number;
  simulated: boolean;
  intakeContext?: string;
}>;
export type PlannerErrorCode = 'INVALID' | 'FORBIDDEN' | 'CONFLICT' | 'NOT_FOUND' | 'INVALID_DRAFT';
