/**
 * Stood platform APILib
 *
 * This file was automatically generated for Stood by APIMATIC v3.0 ( https://www.apimatic.io ).
 */

import { array, lazy, number, object, Schema, string } from '../schema.js';
import { Milestone, milestoneSchema } from './milestone.js';
import { Money, moneySchema } from './money.js';

export interface AllowanceDraft {
  payeeRef: string;
  cap: Money;
  milestones: Milestone[];
  windowDays: number;
  maxResubmits: number;
}

export const allowanceDraftSchema: Schema<AllowanceDraft> = lazy(() =>
  object({
    payeeRef: ['payee_ref', string()],
    cap: ['cap', moneySchema],
    milestones: ['milestones', array(milestoneSchema)],
    windowDays: ['window_days', number()],
    maxResubmits: ['max_resubmits', number()],
  })
);
