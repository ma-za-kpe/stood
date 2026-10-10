/**
 * Stood platform APILib
 *
 * This file was automatically generated for Stood by APIMATIC v3.0 ( https://www.apimatic.io ).
 */

import { Schema, stringEnum } from '../schema.js';

/**
 * Enum for FundingStatus
 */
export enum FundingStatus {
  Reserved = 'RESERVED',
  Creating = 'CREATING',
  AwaitingApproval = 'AWAITING_APPROVAL',
  Authorizing = 'AUTHORIZING',
  Held = 'HELD',
  Failed = 'FAILED',
  Expired = 'EXPIRED',
}

/**
 * Schema for FundingStatus
 */
export const fundingStatusSchema: Schema<FundingStatus> = stringEnum(
  FundingStatus
);
