/**
 * Stood platform APILib
 *
 * This file was automatically generated for Stood by APIMATIC v3.0 ( https://www.apimatic.io ).
 */

import { nullable, number, object, Schema, string } from '../schema.js';
import { MandateStatus, mandateStatusSchema } from './mandateStatus.js';

export interface Mandate {
  key: string;
  status: MandateStatus;
  /** Only while AWAITING_APPROVAL: where the buyer approves */
  approveUrl: string | null;
  /** When the signing request lapses, Unix milliseconds */
  expiresAt: number;
}

export const mandateSchema: Schema<Mandate> = object({
  key: ['key', string()],
  status: ['status', mandateStatusSchema],
  approveUrl: ['approve_url', nullable(string())],
  expiresAt: ['expires_at', number()],
});
