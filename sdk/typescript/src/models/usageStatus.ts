/**
 * Stood platform APILib
 *
 * This file was automatically generated for Stood by APIMATIC v3.0 ( https://www.apimatic.io ).
 */

import { Schema, stringEnum } from '../schema.js';

/**
 * Enum for UsageStatus
 */
export enum UsageStatus {
  Accepted = 'ACCEPTED',
}

/**
 * Schema for UsageStatus
 */
export const usageStatusSchema: Schema<UsageStatus> = stringEnum(UsageStatus);
