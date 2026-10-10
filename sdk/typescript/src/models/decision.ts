/**
 * Stood platform APILib
 *
 * This file was automatically generated for Stood by APIMATIC v3.0 ( https://www.apimatic.io ).
 */

import {
  nullable,
  optional,
  Schema,
  string,
  typedExpandoObject,
  unknown,
} from '../schema.js';
import { DecisionOutcome, decisionOutcomeSchema } from './decisionOutcome.js';
import { PaymentEffect, paymentEffectSchema } from './paymentEffect.js';

export interface Decision {
  outcome: DecisionOutcome;
  effect: PaymentEffect;
  profileId: string;
  ruleSetVersion: string;
  namedField: string | null;
  reason: string;
  detail?: unknown;
  additionalProperties?: Record<string, unknown>;
}

export const decisionSchema: Schema<Decision> = typedExpandoObject(
  {
    outcome: ['outcome', decisionOutcomeSchema],
    effect: ['effect', paymentEffectSchema],
    profileId: ['profileId', string()],
    ruleSetVersion: ['ruleSetVersion', string()],
    namedField: ['namedField', nullable(string())],
    reason: ['reason', string()],
    detail: ['detail', optional(unknown())],
  },
  'additionalProperties',
  optional(unknown())
);
