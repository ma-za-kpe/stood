/**
 * Stood platform APILib
 *
 * This file was automatically generated for Stood by APIMATIC v3.0 ( https://www.apimatic.io ).
 */

import { array, lazy, nullable, object, Schema, string } from '../schema.js';
import { BaselineStatus, baselineStatusSchema } from './baselineStatus.js';
import { BaselineTest, baselineTestSchema } from './baselineTest.js';

export interface Baseline {
  id: string;
  /** QUEUED until Stood has run it; INVALID when the frozen tests are not at the base commit as described */
  status: BaselineStatus;
  repository: string;
  baseCommit: string;
  testBundleHash: string;
  /** Only when DONE: every frozen test as it ran on the base commit; a red baseline is all FAIL */
  tests: BaselineTest[] | null;
  /** Only when DONE: SHA-256 of the run stored in Stood's evidence bucket */
  evidenceSha256: string | null;
  /** UTC ISO-8601 timestamp */
  createdAt: string;
  /** UTC ISO-8601 timestamp */
  finishedAt: string | null;
}

export const baselineSchema: Schema<Baseline> = lazy(() =>
  object({
    id: ['id', string()],
    status: ['status', baselineStatusSchema],
    repository: ['repository', string()],
    baseCommit: ['base_commit', string()],
    testBundleHash: ['test_bundle_hash', string()],
    tests: ['tests', nullable(array(baselineTestSchema))],
    evidenceSha256: ['evidence_sha256', nullable(string())],
    createdAt: ['created_at', string()],
    finishedAt: ['finished_at', nullable(string())],
  })
);
