/**
 * Stood platform APILib
 *
 * This file was automatically generated for Stood by APIMATIC v3.0 ( https://www.apimatic.io ).
 */

import { Schema, stringEnum } from '../schema.js';

/**
 * Enum for BaselineTestStatus
 */
export enum BaselineTestStatus {
  Pass = 'PASS',
  Fail = 'FAIL',
}

/**
 * Schema for BaselineTestStatus
 */
export const baselineTestStatusSchema: Schema<BaselineTestStatus> = stringEnum(
  BaselineTestStatus
);
