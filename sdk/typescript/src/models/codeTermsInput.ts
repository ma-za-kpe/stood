/**
 * Stood platform APILib
 *
 * This file was automatically generated for Stood by APIMATIC v3.0 ( https://www.apimatic.io ).
 */

import {
  array,
  lazy,
  number,
  object,
  optional,
  Schema,
  string,
} from '../schema.js';
import { FrozenTest, frozenTestSchema } from './frozenTest.js';

/** Frozen terms of a code milestone, as a platform sends them. */
export interface CodeTermsInput {
  repository: string;
  baseCommit: string;
  testBundleHash: string;
  manifestHash: string;
  testIds: string[];
  tests: FrozenTest[];
  /** Mutation-score floor from 0 to 1; no floor (0) when omitted */
  minMutation?: number;
}

export const codeTermsInputSchema: Schema<CodeTermsInput> = lazy(() =>
  object({
    repository: ['repository', string()],
    baseCommit: ['baseCommit', string()],
    testBundleHash: ['testBundleHash', string()],
    manifestHash: ['manifestHash', string()],
    testIds: ['testIds', array(string())],
    tests: ['tests', array(frozenTestSchema)],
    minMutation: ['minMutation', optional(number())],
  })
);
