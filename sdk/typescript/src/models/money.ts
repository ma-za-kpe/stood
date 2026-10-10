/**
 * Stood platform APILib
 *
 * This file was automatically generated for Stood by APIMATIC v3.0 ( https://www.apimatic.io ).
 */

import { number, object, Schema, string } from '../schema.js';

export interface Money {
  /** Amount in minor units (cents) */
  minor: number;
  currency: string;
}

export const moneySchema: Schema<Money> = object({
  minor: ['minor', number()],
  currency: ['currency', string()],
});
