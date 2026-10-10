/**
 * Stood platform APILib
 *
 * This file was automatically generated for Stood by APIMATIC v3.0 ( https://www.apimatic.io ).
 */

import { array, lazy, number, object, Schema, string } from '../schema.js';
import { Milestone, milestoneSchema } from './milestone.js';
import { Money, moneySchema } from './money.js';
import { TrancheRef, trancheRefSchema } from './trancheRef.js';

export interface Allowance {
  id: string;
  status: string;
  payeeRef: string;
  cap: Money;
  milestones: Milestone[];
  windowDays: number;
  maxResubmits: number;
  tranches: TrancheRef[];
}

export const allowanceSchema: Schema<Allowance> = lazy(() =>
  object({
    id: ['id', string()],
    status: ['status', string()],
    payeeRef: ['payee_ref', string()],
    cap: ['cap', moneySchema],
    milestones: ['milestones', array(milestoneSchema)],
    windowDays: ['window_days', number()],
    maxResubmits: ['max_resubmits', number()],
    tranches: ['tranches', array(trancheRefSchema)],
  })
);
