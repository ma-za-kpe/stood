/**
 * Stood platform APILib
 *
 * This file was automatically generated for Stood by APIMATIC v3.0 ( https://www.apimatic.io ).
 */

import {
  number,
  optional,
  Schema,
  string,
  typedExpandoObject,
  unknown,
} from '../schema.js';

export interface TrancheHold {
  ageSeconds: number;
  /** UTC ISO-8601 timestamp */
  expiresAt: string;
  additionalProperties?: Record<string, unknown>;
}

export const trancheHoldSchema: Schema<TrancheHold> = typedExpandoObject(
  {
    ageSeconds: ['age_seconds', number()],
    expiresAt: ['expires_at', string()],
  },
  'additionalProperties',
  optional(unknown())
);
