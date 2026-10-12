/**
 * Stood platform APILib
 *
 * This file was automatically generated for Stood by APIMATIC v3.0 ( https://www.apimatic.io ).
 */

import { Schema, stringEnum } from '../schema.js';

/**
 * Enum for UploadStatus
 */
export enum UploadStatus {
  Open = 'OPEN',
  Complete = 'COMPLETE',
}

/**
 * Schema for UploadStatus
 */
export const uploadStatusSchema: Schema<UploadStatus> = stringEnum(
  UploadStatus
);
