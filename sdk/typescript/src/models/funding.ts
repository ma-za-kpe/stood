/**
 * Stood platform APILib
 *
 * This file was automatically generated for Stood by APIMATIC v3.0 ( https://www.apimatic.io ).
 */

import { nullable, number, object, Schema, string } from '../schema.js';
import { FundingStatus, fundingStatusSchema } from './fundingStatus.js';

export interface Funding {
  key: string;
  status: FundingStatus;
  approveUrl: string | null;
  /** Only while HELD: when the hold lapses, Unix milliseconds */
  holdExpiresAt: number | null;
}

export const fundingSchema: Schema<Funding> = object({
  key: ['key', string()],
  status: ['status', fundingStatusSchema],
  approveUrl: ['approve_url', nullable(string())],
  holdExpiresAt: ['hold_expires_at', nullable(number())],
});
