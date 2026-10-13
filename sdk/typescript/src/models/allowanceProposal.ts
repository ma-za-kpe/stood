/**
 * Stood platform APILib
 *
 * This file was automatically generated for Stood by Maku Mazakpe by APIMATIC v3.0 ( https://www.apimatic.io ).
 */

import { lazy, number, object, Schema } from '../schema.js';
import { AllowanceDraft, allowanceDraftSchema } from './allowanceDraft.js';

export interface AllowanceProposal {
  expectedVersion: number;
  terms: AllowanceDraft;
}

export const allowanceProposalSchema: Schema<AllowanceProposal> = lazy(() =>
  object({
    expectedVersion: ['expected_version', number()],
    terms: ['terms', allowanceDraftSchema],
  })
);
