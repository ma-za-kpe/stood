import { fileURLToPath } from 'node:url';

const source = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// Unit tests exercise workspace source directly. Typecheck/build tasks separately verify package exports
// and emitted artifacts, so a fresh workspace test never depends on stale or prebuilt dist/ directories.
export const workspaceAliases = {
  '@stood/yard-contracts': source('./packages/yard-contracts/src/index.ts'),
  '@stood/yard-domain': source('./packages/yard-domain/src/index.ts'),
  '@stood/stood-sdk': source('./packages/stood-sdk/src/index.ts'),
  '@stood/yard-foreman': source('./services/yard-foreman/src/index.ts'),
};
