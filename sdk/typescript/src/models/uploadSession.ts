/**
 * Stood platform APILib
 *
 * This file was automatically generated for Stood by APIMATIC v3.0 ( https://www.apimatic.io ).
 */

import {
  array,
  lazy,
  nullable,
  number,
  object,
  Schema,
  string,
} from '../schema.js';
import { SignedUpload, signedUploadSchema } from './signedUpload.js';
import {
  StoredUploadPhoto,
  storedUploadPhotoSchema,
} from './storedUploadPhoto.js';
import { UploadStatus, uploadStatusSchema } from './uploadStatus.js';

/** COMPLETE means owned bytes, size, hash and format header checked; no assessment or payment. URLs are derived short-lived capabilities, not persisted receipts. */
export interface UploadSession {
  id: string;
  trancheId: string;
  status: UploadStatus;
  photos: StoredUploadPhoto[];
  expiresAt: number;
  completedAt: number | null;
  uploads: SignedUpload[];
}

export const uploadSessionSchema: Schema<UploadSession> = lazy(() =>
  object({
    id: ['id', string()],
    trancheId: ['trancheId', string()],
    status: ['status', uploadStatusSchema],
    photos: ['photos', array(storedUploadPhotoSchema)],
    expiresAt: ['expiresAt', number()],
    completedAt: ['completedAt', nullable(number())],
    uploads: ['uploads', array(signedUploadSchema)],
  })
);
