/**
 * Stood platform APILib
 *
 * This file was automatically generated for Stood by APIMATIC v3.0 ( https://www.apimatic.io ).
 */

import { Schema, stringEnum } from '../schema.js';

/**
 * Enum for PackageWaitingFor
 */
export enum PackageWaitingFor {
  Hold = 'HOLD',
  Renewal = 'RENEWAL',
  Runner = 'RUNNER',
}

/**
 * Schema for PackageWaitingFor
 */
export const packageWaitingForSchema: Schema<PackageWaitingFor> = stringEnum(
  PackageWaitingFor
);
