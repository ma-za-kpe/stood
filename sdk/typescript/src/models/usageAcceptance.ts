/**
 * Stood platform APILib
 *
 * This file was automatically generated for Stood by APIMATIC v3.0 ( https://www.apimatic.io ).
 */

import { object, Schema, string } from '../schema.js';

export interface UsageAcceptance {
  trancheId: string;
  commit: string;
  status: string;
  /** UTC ISO-8601 timestamp */
  acceptedAt: string;
}

export const usageAcceptanceSchema: Schema<UsageAcceptance> = object({
  trancheId: ['tranche_id', string()],
  commit: ['commit', string()],
  status: ['status', string()],
  acceptedAt: ['accepted_at', string()],
});
