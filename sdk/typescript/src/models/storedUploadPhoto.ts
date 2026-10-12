/**
 * Stood platform APILib
 *
 * This file was automatically generated for Stood by APIMATIC v3.0 ( https://www.apimatic.io ).
 */

import { number, object, Schema, string } from '../schema.js';
import {
  PhotoContentType,
  photoContentTypeSchema,
} from './photoContentType.js';

export interface StoredUploadPhoto {
  sha256: string;
  bytes: number;
  contentType: PhotoContentType;
  key: string;
}

export const storedUploadPhotoSchema: Schema<StoredUploadPhoto> = object({
  sha256: ['sha256', string()],
  bytes: ['bytes', number()],
  contentType: ['contentType', photoContentTypeSchema],
  key: ['key', string()],
});
