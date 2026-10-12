/**
 * Stood platform APILib
 *
 * This file was automatically generated for Stood by APIMATIC v3.0 ( https://www.apimatic.io ).
 */

import { Schema, stringEnum } from '../schema.js';

/**
 * Enum for PhotoContentType
 */
export enum PhotoContentType {
  EnumImagejpeg = 'image/jpeg',
  EnumImageheic = 'image/heic',
  EnumImagewebp = 'image/webp',
}

/**
 * Schema for PhotoContentType
 */
export const photoContentTypeSchema: Schema<PhotoContentType> = stringEnum(
  PhotoContentType
);
