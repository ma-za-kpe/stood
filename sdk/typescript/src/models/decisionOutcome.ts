/**
 * Stood platform APILib
 *
 * This file was automatically generated for Stood by APIMATIC v3.0 ( https://www.apimatic.io ).
 */

import { Schema, stringEnum } from '../schema.js';

/**
 * Enum for DecisionOutcome
 */
export enum DecisionOutcome {
  Release = 'RELEASE',
  Refuse = 'REFUSE',
  Wait = 'WAIT',
}

/**
 * Schema for DecisionOutcome
 */
export const decisionOutcomeSchema: Schema<DecisionOutcome> = stringEnum(
  DecisionOutcome
);
