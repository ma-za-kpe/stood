/**
 * Stood platform APILib
 *
 * This file was automatically generated for Stood by APIMATIC v3.0 ( https://www.apimatic.io ).
 */

import { object, Schema, string } from '../schema.js';

export interface CommitPackageInput {
  repository: string;
  baseCommit: string;
  commitSha: string;
  reportRef: string;
  reportSha256: string;
}

export const commitPackageInputSchema: Schema<CommitPackageInput> = object({
  repository: ['repository', string()],
  baseCommit: ['base_commit', string()],
  commitSha: ['commit_sha', string()],
  reportRef: ['report_ref', string()],
  reportSha256: ['report_sha256', string()],
});
