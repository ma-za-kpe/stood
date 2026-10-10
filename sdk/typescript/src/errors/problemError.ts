/**
 * Stood platform APILib
 *
 * This file was automatically generated for Stood by APIMATIC v3.0 ( https://www.apimatic.io ).
 */

import { ApiError } from '../core.js';

/**
 * Creates an instance of Problem
 */
interface Problem {
  /** urn:stood:problem:<code> */
  type: string;
  title: string;
  status: number;
  code: string;
  detail: string;
  additionalProperties?: Record<string, unknown>;
}

export class ProblemError extends ApiError<Problem> {}
