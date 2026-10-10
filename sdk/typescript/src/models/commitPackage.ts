/**
 * Stood platform APILib
 *
 * This file was automatically generated for Stood by APIMATIC v3.0 ( https://www.apimatic.io ).
 */

import { lazy, object, Schema, string } from '../schema.js';
import {
  CommitPackageInput,
  commitPackageInputSchema,
} from './commitPackageInput.js';
import {
  PackageWaitingFor,
  packageWaitingForSchema,
} from './packageWaitingFor.js';

export interface CommitPackage {
  id: string;
  trancheId: string;
  status: string;
  waitingFor: PackageWaitingFor;
  metadata: CommitPackageInput;
  /** UTC ISO-8601 timestamp */
  createdAt: string;
}

export const commitPackageSchema: Schema<CommitPackage> = lazy(() =>
  object({
    id: ['id', string()],
    trancheId: ['trancheId', string()],
    status: ['status', string()],
    waitingFor: ['waitingFor', packageWaitingForSchema],
    metadata: ['metadata', commitPackageInputSchema],
    createdAt: ['createdAt', string()],
  })
);
