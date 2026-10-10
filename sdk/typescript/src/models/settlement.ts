/**
 * Stood platform APILib
 *
 * This file was automatically generated for Stood by APIMATIC v3.0 ( https://www.apimatic.io ).
 */

import {
  optional,
  Schema,
  string,
  typedExpandoObject,
  unknown,
} from '../schema.js';

export interface Settlement {
  effect: string;
  additionalProperties?: Record<string, unknown>;
}

export const settlementSchema: Schema<Settlement> = typedExpandoObject(
  { effect: ['effect', string()] },
  'additionalProperties',
  optional(unknown())
);
