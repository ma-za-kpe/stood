/**
 * Stood platform APILib
 *
 * This file was automatically generated for Stood by APIMATIC v3.0 ( https://www.apimatic.io ).
 */

import {
  anyOf,
  dict,
  isMappedValueValidForSchema,
  lazy,
  Schema,
  unknown,
} from '../../schema.js';
import { CodeTerms, codeTermsSchema } from '../codeTerms.js';

/** This is a container type for any-of types. */
export type MilestoneParams = CodeTerms | Record<string, unknown>;

export const milestoneParamsSchema: Schema<MilestoneParams> = lazy(() =>
  anyOf([codeTermsSchema, dict(unknown())])
);

export namespace MilestoneParams {
  /**
   * Validation method to narrow down union type to CodeTerms type case.
   *
   * This is CodeTerms case.
   */
  export function isCodeTerms(value: unknown): value is CodeTerms {
    return isMappedValueValidForSchema(value, codeTermsSchema);
  }

  /**
   * Validation method to narrow down union type to Record<string, unknown> type case.
   *
   * This is Map of Object case.
   */
  export function isMapOfUnknown(
    value: unknown
  ): value is Record<string, unknown> {
    return typeof value === 'object';
  }
}
