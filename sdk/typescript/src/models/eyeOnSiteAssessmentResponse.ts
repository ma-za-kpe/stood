/**
 * Stood platform APILib
 *
 * This file was automatically generated for Stood by Maku Mazakpe by APIMATIC v3.0 ( https://www.apimatic.io ).
 */

import { dict, object, optional, Schema, string, unknown } from '../schema.js';

/** Authenticated EyeOnSite evidence retained for audit only; it has no payment or milestone decision authority. */
export interface EyeOnSiteAssessmentResponse {
  receipt?: Record<string, unknown>;
  authority: string;
}

export const eyeOnSiteAssessmentResponseSchema: Schema<EyeOnSiteAssessmentResponse> = object(
  {
    receipt: ['receipt', optional(dict(unknown()))],
    authority: ['authority', string()],
  }
);
