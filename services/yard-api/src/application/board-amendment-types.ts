import type { MandateView } from '@stood/stood-sdk';
import type { MandateRequest } from './mandate-request.js';

export type EvidenceChange = Readonly<{
  milestoneId: string;
  testBundleHash: string;
  manifestHash: string;
  testIds: readonly string[];
  tests: readonly Readonly<{ id: string; path: string }>[];
}>;

export type AmendmentIntent = {
  key: string;
  inputHash: string;
  allowanceId: string;
  expectedVersion: number;
  request: MandateRequest;
  changes: readonly EvidenceChange[];
  status: 'RESERVED' | 'SIGNED' | 'NEEDS_REVISION';
  receipt?: Readonly<{ version: number; termsHash: string }>;
  signing?: MandateView;
  signingKey?: string;
};
