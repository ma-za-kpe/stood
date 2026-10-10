/**
 * Stood platform APILib
 *
 * This file was automatically generated for Stood by APIMATIC v3.0 ( https://www.apimatic.io ).
 */

import { object, Schema, string } from '../schema.js';

export interface PendingPaymentOperation {
  effect: string;
  status: string;
  /** UTC ISO-8601 timestamp */
  createdAt: string;
}

export const pendingPaymentOperationSchema: Schema<PendingPaymentOperation> = object(
  {
    effect: ['effect', string()],
    status: ['status', string()],
    createdAt: ['created_at', string()],
  }
);
