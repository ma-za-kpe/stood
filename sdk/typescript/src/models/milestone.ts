/**
 * Stood platform APILib
 *
 * This file was automatically generated for Stood by APIMATIC v3.0 ( https://www.apimatic.io ).
 */

import { lazy, object, optional, Schema, string } from '../schema.js';
import {
  MilestoneParams,
  milestoneParamsSchema,
} from './containers/milestoneParams.js';
import { Money, moneySchema } from './money.js';

export interface Milestone {
  name: string;
  amount: Money;
  /** Evidence profile, e.g. code.milestone@1 or code.final@1 */
  profile: string;
  /** CodeTerms for code.* profiles (checked); other profiles take their own parameters */
  params?: MilestoneParams;
}

export const milestoneSchema: Schema<Milestone> = lazy(() =>
  object({
    name: ['name', string()],
    amount: ['amount', moneySchema],
    profile: ['profile', string()],
    params: ['params', optional(milestoneParamsSchema)],
  })
);
