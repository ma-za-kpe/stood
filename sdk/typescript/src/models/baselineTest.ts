/**
 * Stood platform APILib
 *
 * This file was automatically generated for Stood by APIMATIC v3.0 ( https://www.apimatic.io ).
 */

import { object, Schema, string } from '../schema.js';
import {
  BaselineTestStatus,
  baselineTestStatusSchema,
} from './baselineTestStatus.js';

export interface BaselineTest {
  id: string;
  status: BaselineTestStatus;
}

export const baselineTestSchema: Schema<BaselineTest> = object({
  id: ['id', string()],
  status: ['status', baselineTestStatusSchema],
});
