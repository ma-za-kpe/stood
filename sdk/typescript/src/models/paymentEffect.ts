/**
 * Stood platform APILib
 *
 * This file was automatically generated for Stood by APIMATIC v3.0 ( https://www.apimatic.io ).
 */

import { Schema, stringEnum } from '../schema.js';

/**
 * Enum for PaymentEffect
 */
export enum PaymentEffect {
  Capture = 'CAPTURE',
  Void = 'VOID',
  None = 'NONE',
  Review = 'REVIEW',
}

/**
 * Schema for PaymentEffect
 */
export const paymentEffectSchema: Schema<PaymentEffect> = stringEnum(
  PaymentEffect
);
