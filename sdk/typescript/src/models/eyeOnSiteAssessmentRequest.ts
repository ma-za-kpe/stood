/**
 * Stood platform APILib
 *
 * This file was automatically generated for Stood by Maku Mazakpe by APIMATIC v3.0 ( https://www.apimatic.io ).
 */

import { object, Schema, string } from '../schema.js';

export interface EyeOnSiteAssessmentRequest {
  evidenceId: string;
}

export const eyeOnSiteAssessmentRequestSchema: Schema<EyeOnSiteAssessmentRequest> = object(
  { evidenceId: ['evidenceId', string()] }
);
