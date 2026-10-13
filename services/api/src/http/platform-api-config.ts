import type { UsageAuthority } from '../application/usage-intake.js';
import type { AllowanceVersionStore } from '../ports/allowance-version-store.js';
import type { BaselineStore } from '../ports/baseline-store.js';
import type { CommitPackageStore } from '../ports/commit-package-store.js';
import type { FundingStore } from '../ports/funding-store.js';
import type { MandateStore } from '../ports/mandate-store.js';
import type { PlatformApiStore } from '../ports/platform-api-store.js';
import type { RateLimiter } from '../ports/rate-limiter.js';
import type { UploadObjects, UploadStore } from '../ports/upload-store.js';
import type { UsageStore } from '../ports/usage-store.js';

export type PlatformApiConfig = Readonly<{
  store: PlatformApiStore;
  versions?: AllowanceVersionStore;
  packages?: CommitPackageStore;
  uploads?: Readonly<{ store: UploadStore; objects: UploadObjects }>;
  // C4 (#77): baselines that prove a milestone's frozen tests fail on the base commit.
  baselines?: Pick<BaselineStore, 'request' | 'get'>;
  // C4 (#77): the buyer's signed confirmation that a final milestone is in use, and who may sign it.
  usage?: Readonly<{ store: UsageStore; authorities: readonly UsageAuthority[] }>;
  platformId: string;
  key: string;
  secret: string;
  clock(): number;
  // T-0156: per-platform write and read budgets and failed sign-ins per client, shared across instances.
  limiter?: RateLimiter;
  // T-0260: saved-PayPal mandates and tranche funding. HTTP records intent; the worker makes the PayPal calls.
  signing?: Readonly<{
    mode: 'sim' | 'live';
    mandates: Pick<MandateStore, 'reserve' | 'load'>;
    funding: Pick<FundingStore, 'reserve' | 'load'>;
  }>;
}>;
