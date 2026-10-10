/**
 * Stood platform APILib
 *
 * This file was automatically generated for Stood by APIMATIC v3.0 ( https://www.apimatic.io ).
 */

import {
  array,
  lazy,
  number,
  optional,
  Schema,
  string,
  typedExpandoObject,
  unknown,
} from '../schema.js';
import { FrozenTest, frozenTestSchema } from './frozenTest.js';

/** Frozen terms of a code milestone (profiles code.*), checked at draft time. */
export interface CodeTerms {
  repository: string;
  baseCommit: string;
  testBundleHash: string;
  manifestHash: string;
  testIds: string[];
  tests: FrozenTest[];
  /** Mutation-score floor from 0 to 1; no floor (0) when omitted */
  minMutation?: number;
  additionalProperties?: Record<string, unknown>;
}

export const codeTermsSchema: Schema<CodeTerms> = lazy(() =>
  typedExpandoObject(
    {
      repository: ['repository', string()],
      baseCommit: ['baseCommit', string()],
      testBundleHash: ['testBundleHash', string()],
      manifestHash: ['manifestHash', string()],
      testIds: ['testIds', array(string())],
      tests: ['tests', array(frozenTestSchema)],
      minMutation: ['minMutation', optional(number())],
    },
    'additionalProperties',
    optional(unknown())
  )
);
