import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

// CI must not fail on a registry's rate limit. Docker Hub throttles anonymous pulls shared across GitHub's runners
// (429 on 2026-10-09), so every image comes from a registry host such as mirror.gcr.io, ghcr.io or gcr.io, pinned
// by digest so a mirror serves the same bytes.
const files = [
  'Dockerfile',
  'services/yard-api/Dockerfile',
  'tools/site/Dockerfile.test',
  'compose.yaml',
  'compose.mock.yaml',
  'scripts/check-hosted-yard',
  'scripts/check-docker',
  'scripts/check-site',
  '.pre-commit-config.yaml',
];
const reference = /(?:^FROM\s+|image:\s+|entry:\s+|^\s+)([a-z0-9][a-z0-9._/-]*(?::[\w.-]+)?@sha256:[a-f0-9]{64})/gm;

it('pulls every container image from a named registry, pinned by digest, never anonymous Docker Hub', () => {
  const images = files.flatMap((f) => [...readFileSync(f, 'utf8').matchAll(reference)].map((m) => `${f}: ${m[1]}`));
  expect(images.length).toBeGreaterThan(8);
  const hubOnly = images.filter((i) => !/^[^:]+: [a-z0-9-]+(\.[a-z0-9-]+)+\//.test(i));
  expect(hubOnly).toEqual([]);
  for (const f of files)
    for (const line of readFileSync(f, 'utf8').split('\n'))
      if (/^FROM\s+(?!\w+\s*$)/.test(line) && !/^FROM\s+\w+\s+AS\b/i.test(line))
        expect(line, f).toMatch(/@sha256:[a-f0-9]{64}/);
});
