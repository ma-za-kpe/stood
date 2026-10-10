/**
 * Stood platform APILib
 *
 * This file was automatically generated for Stood by APIMATIC v3.0 ( https://www.apimatic.io ).
 */

import { lazy, number, object, Schema, string } from '../schema.js';
import { UsageAuthority, usageAuthoritySchema } from './usageAuthority.js';

/** The buyer's signed confirmation that a final milestone is in use */
export interface UsageReceipt {
  version: number;
  allowanceId: string;
  trancheId: string;
  /** The tranche's latest submitted package commit */
  commit: string;
  /** A key Stood is configured to trust, outside the builder's tree */
  authority: UsageAuthority;
  /** When the buyer confirmed use, Unix milliseconds (within 24 hours) */
  observedAt: number;
  nonce: string;
  /** Base64 Ed25519 signature over "stood-usage-receipt/v1", allowanceId, trancheId, commit, keyId, root, observedAt and nonce, joined by NUL */
  signature: string;
}

export const usageReceiptSchema: Schema<UsageReceipt> = lazy(() =>
  object({
    version: ['version', number()],
    allowanceId: ['allowanceId', string()],
    trancheId: ['trancheId', string()],
    commit: ['commit', string()],
    authority: ['authority', usageAuthoritySchema],
    observedAt: ['observedAt', number()],
    nonce: ['nonce', string()],
    signature: ['signature', string()],
  })
);
