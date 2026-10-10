/**
 * Stood platform APILib
 *
 * This file was automatically generated for Stood by APIMATIC v3.0 ( https://www.apimatic.io ).
 */

import { object, Schema, string } from '../schema.js';

export interface FrozenTest {
  id: string;
  path: string;
}

export const frozenTestSchema: Schema<FrozenTest> = object({
  id: ['id', string()],
  path: ['path', string()],
});
