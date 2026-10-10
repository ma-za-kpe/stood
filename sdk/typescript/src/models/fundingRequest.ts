/**
 * Stood platform APILib
 *
 * This file was automatically generated for Stood by APIMATIC v3.0 ( https://www.apimatic.io ).
 */

import { number, object, Schema, string } from '../schema.js';

export interface FundingRequest {
  /** The tranche version just read */
  expectedVersion: number;
  nonce: string;
}

export const fundingRequestSchema: Schema<FundingRequest> = object({
  expectedVersion: ['expected_version', number()],
  nonce: ['nonce', string()],
});
