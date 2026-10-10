/**
 * Stood platform APILib
 *
 * This file was automatically generated for Stood by APIMATIC v3.0 ( https://www.apimatic.io ).
 */

import { Schema, stringEnum } from '../schema.js';

/**
 * Enum for BaselineStatus
 */
export enum BaselineStatus {
  Queued = 'QUEUED',
  Done = 'DONE',
  Invalid = 'INVALID',
}

/**
 * Schema for BaselineStatus
 */
export const baselineStatusSchema: Schema<BaselineStatus> = stringEnum(
  BaselineStatus
);
