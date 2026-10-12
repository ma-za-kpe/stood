/**
 * Stood platform APILib
 *
 * This file was automatically generated for Stood by APIMATIC v3.0 ( https://www.apimatic.io ).
 */

import { dict, object, Schema, string } from '../schema.js';

export interface SignedUpload {
  key: string;
  url: string;
  headers: Record<string, string>;
}

export const signedUploadSchema: Schema<SignedUpload> = object({
  key: ['key', string()],
  url: ['url', string()],
  headers: ['headers', dict(string())],
});
