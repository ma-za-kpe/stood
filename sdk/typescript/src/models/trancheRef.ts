/**
 * Stood platform APILib
 *
 * This file was automatically generated for Stood by APIMATIC v3.0 ( https://www.apimatic.io ).
 */

import { object, Schema, string } from '../schema.js';

export interface TrancheRef {
  id: string;
  name: string;
}

export const trancheRefSchema: Schema<TrancheRef> = object({
  id: ['id', string()],
  name: ['name', string()],
});
