#!/usr/bin/env node

const paths = process.argv.slice(2).map((path) => path.replaceAll('\\', '/'));

const fullGateRules = [
  [/^(\.github\/|\.pre-commit-config\.yaml$|(?:.*\/)?Dockerfile$|(?:.*\/)?compose.*\.ya?ml$)/, 'CI or container execution changed'],
  [
    /^(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|turbo\.json|biome\.json|\.dependency-cruiser\.cjs|render\.yaml|\.env\.example|vitest-workspaces\.ts|(?:.*\/)?package\.json|(?:.*\/)?tsconfig[^/]*\.json|(?:.*\/)?(?:vitest|vite)(?:\.[^/]+)?\.config\.[cm]?[jt]s)$/,
    'workspace manifest or shared build/test configuration changed',
  ],
  [/^scripts\//, 'shared validation or operational tooling changed'],
  [/^tools\/site\//, 'site build and browser qualification changed'],
  [/^openapi\//, 'published API contract changed'],
  [/^(?:sdk\/|apimatic\/|services\/[^/]+\/.*\.sdk\.test\.ts$)/, 'generated SDK or SDK qualification changed'],
  [/^site\//, 'site assets or browser qualification changed'],
  [/^services\/[^/]+\/drizzle\//, 'database migration changed'],
  [/^services\/[^/]+\/src\/adapters\/db-postgres\//, 'Postgres adapter changed'],
  [/^services\/[^/]+\/.*\.db\.test\.ts$/, 'database integration test changed'],
  [/^services\/api\/src\/domain\//, 'payment decision domain changed'],
  [/^services\/api\/src\/adapters\/payments-paypal\//, 'PayPal payment adapter changed'],
  [/^services\/api\/src\/http\/contract\.ts$/, 'API contract source changed'],
  [/^packages\/yard-domain\//, 'Yard domain retains a 100% coverage floor'],
];

const workspaceRoots = [
  'apps/yard-web/',
  'packages/contracts/',
  'packages/stood-sdk/',
  'packages/yard-contracts/',
  'packages/yard-domain/',
  'services/api/',
  'services/simulators/',
  'services/yard-api/',
  'services/yard-foreman/',
];

if (paths.length === 0) {
  process.stdout.write('full::No changed paths were available; use the full gate.\n');
  process.exit(0);
}

for (const path of paths) {
  const rule = fullGateRules.find(([pattern]) => pattern.test(path));
  if (rule) {
    process.stdout.write(`full::${rule[1]} (${path})\n`);
    process.exit(0);
  }

  if (!workspaceRoots.some((root) => path.startsWith(root))) {
    process.stdout.write(`full::Changed path is outside a declared workspace (${path}); use the full gate.\n`);
    process.exit(0);
  }
}

process.stdout.write(`affected::${paths.length} changed path(s); run affected workspace tasks.\n`);
