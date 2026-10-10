/**
 * Stood platform APILib
 *
 * This file was automatically generated for Stood by APIMATIC v3.0 ( https://www.apimatic.io ).
 */

import { Schema, stringEnum } from '../schema.js';

/**
 * Enum for MandateStatus
 */
export enum MandateStatus {
  Reserved = 'RESERVED',
  Creating = 'CREATING',
  AwaitingApproval = 'AWAITING_APPROVAL',
  Tokenizing = 'TOKENIZING',
  Signed = 'SIGNED',
  Revoked = 'REVOKED',
}

/**
 * Schema for MandateStatus
 */
export const mandateStatusSchema: Schema<MandateStatus> = stringEnum(
  MandateStatus
);
