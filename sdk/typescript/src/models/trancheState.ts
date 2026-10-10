/**
 * Stood platform APILib
 *
 * This file was automatically generated for Stood by APIMATIC v3.0 ( https://www.apimatic.io ).
 */

import { Schema, stringEnum } from '../schema.js';

/**
 * Enum for TrancheState
 */
export enum TrancheState {
  Pending = 'PENDING',
  WaitFunding = 'WAIT_FUNDING',
  Held = 'HELD',
  Deciding = 'DECIDING',
  Waiting = 'WAITING',
  CapturePending = 'CAPTURE_PENDING',
  VoidPending = 'VOID_PENDING',
  ReauthorizePending = 'REAUTHORIZE_PENDING',
  Released = 'RELEASED',
  Refused = 'REFUSED',
  Expired = 'EXPIRED',
  Cancelled = 'CANCELLED',
  Disputed = 'DISPUTED',
}

/**
 * Schema for TrancheState
 */
export const trancheStateSchema: Schema<TrancheState> = stringEnum(
  TrancheState
);
