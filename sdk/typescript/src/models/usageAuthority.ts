/**
 * Stood platform APILib
 *
 * This file was automatically generated for Stood by APIMATIC v3.0 ( https://www.apimatic.io ).
 */

import { object, Schema, string } from '../schema.js';

/** A key Stood is configured to trust, outside the builder's tree */
export interface UsageAuthority {
  keyId: string;
  root: string;
}

export const usageAuthoritySchema: Schema<UsageAuthority> = object({
  keyId: ['keyId', string()],
  root: ['root', string()],
});
