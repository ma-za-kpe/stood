/**
 * Stood platform APILib
 *
 * This file was automatically generated for Stood by Maku Mazakpe by APIMATIC v3.0 ( https://www.apimatic.io ).
 */

import { lazy, number, object, Schema, string } from '../schema.js';
import { Allowance, allowanceSchema } from './allowance.js';

export interface AllowanceVersion {
  version: number;
  body: Allowance;
  termsHash: string;
}

export const allowanceVersionSchema: Schema<AllowanceVersion> = lazy(() =>
  object({
    version: ['version', number()],
    body: ['body', allowanceSchema],
    termsHash: ['terms_hash', string()],
  })
);
