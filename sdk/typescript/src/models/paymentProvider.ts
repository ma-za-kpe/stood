/**
 * Stood platform APILib
 *
 * This file was automatically generated for Stood by APIMATIC v3.0 ( https://www.apimatic.io ).
 */

import { Schema, stringEnum } from '../schema.js';

/**
 * Enum for PaymentProvider
 */
export enum PaymentProvider {
  Paypalsandbox = 'paypal-sandbox',
  Simulator = 'simulator',
}

/**
 * Schema for PaymentProvider
 */
export const paymentProviderSchema: Schema<PaymentProvider> = stringEnum(
  PaymentProvider
);
