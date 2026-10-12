/**
 * Stood platform APILib
 *
 * This file was automatically generated for Stood by Maku Mazakpe by APIMATIC v3.0 ( https://www.apimatic.io ).
 */

import { array, lazy, object, Schema } from '../schema.js';
import { UploadPhoto, uploadPhotoSchema } from './uploadPhoto.js';

export interface UploadInput {
  photos: UploadPhoto[];
}

export const uploadInputSchema: Schema<UploadInput> = lazy(() =>
  object({ photos: ['photos', array(uploadPhotoSchema)] })
);
