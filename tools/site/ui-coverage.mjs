import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseAstAsync } from 'vitest/node';

// Reuse the exact converter and coverage map already pinned by Vitest; no new instrumentation dependency.
const requireCoverage = createRequire(import.meta.resolve('@vitest/coverage-v8'));
const { default: convert } = await import(pathToFileURL(requireCoverage.resolve('ast-v8-to-istanbul')).href);
const { mergeScriptCovs } = await import(pathToFileURL(requireCoverage.resolve('@bcoe/v8-coverage')).href);
const { createCoverageMap } = await import(
  pathToFileURL(requireCoverage.resolve('@vitest/istanbul-lib-coverage')).href
);
const root = resolve('apps/yard-web/src');
const unit = JSON.parse(readFileSync('artifacts/ui-audit/unit-coverage/coverage-final.json', 'utf8'));
const inventory = readdirSync(root, { recursive: true }).filter(
  (name) => /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name),
);
const coverage = createCoverageMap({});
const unitInventory = createCoverageMap(unit);
assert(
  inventory.every((name) => unitInventory.files().includes(resolve(root, name))),
  'unit report must include every app source file',
);
// Add executed unit results first. Append all-zero uncovered-file placeholders only after browser remapping,
// as Vitest does, so alternative JSX transforms do not duplicate an entirely unexecuted screen inventory.
for (const [file, data] of Object.entries(unit)) {
  if (Object.values(data.s).some((count) => count > 0) || Object.values(data.f).some((count) => count > 0)) {
    coverage.merge({ [file]: data });
  }
}
const scripts = new Map();
for (const report of [
  'artifacts/hosted-yard/coverage-desktop.json',
  'artifacts/hosted-yard/coverage-mobile.json',
  'artifacts/mock-network/browser-coverage.json',
]) {
  const entries = JSON.parse(readFileSync(report, 'utf8'));
  assert(entries.length > 0, 'browser instrumentation must not be empty');
  for (const entry of entries) {
    const bundle = resolve('apps/yard-web/dist/assets', new URL(entry.url).pathname.split('/').at(-1));
    // Restarting Chromium coverage can report an already parsed script without its source text.
    // Recover from the exact hash-named build artifact and require captured bytes to match it.
    const builtSource = readFileSync(bundle, 'utf8');
    const source = entry.source ?? builtSource;
    assert(source === builtSource, 'browser script must match the exact local build artifact');
    const sourceMap = {
      ...entry.sourceMap,
      sources: entry.sourceMap.sources.map((source) => resolve(dirname(bundle), source)),
    };
    for (const [index, file] of sourceMap.sources.entries()) {
      if (file.startsWith(`${root}/`)) {
        assert.equal(sourceMap.sourcesContent[index], readFileSync(file, 'utf8'), `stale browser source: ${file}`);
      }
    }
    const url = pathToFileURL(bundle).href;
    const previous = scripts.get(url);
    if (previous) assert(previous.source === source, 'coverage bundles must match');
    scripts.set(url, {
      source,
      sourceMap,
      coverage: mergeScriptCovs([
        ...(previous ? [previous.coverage] : []),
        { scriptId: entry.scriptId, url, functions: entry.functions },
      ]),
    });
  }
}
for (const entry of scripts.values()) {
  const mapped = await convert({
    code: entry.source,
    sourceMap: entry.sourceMap,
    coverage: entry.coverage,
    wrapperLength: 0,
    ast: await parseAstAsync(entry.source),
  });
  const app = Object.fromEntries(Object.entries(mapped).filter(([file]) => file.startsWith(`${root}/`)));
  writeFileSync('artifacts/ui-audit/browser-remapped.json', JSON.stringify(app));
  assert(
    Object.keys(app).some((file) => file.endsWith('/App.tsx')),
    'source map must cover the actual app entry',
  );
  coverage.merge(app);
}

for (const name of inventory) {
  const file = resolve(root, name);
  if (!coverage.files().includes(file)) coverage.merge({ [file]: unit[file] });
}
for (const name of ['BlueprintEditor.tsx', 'IntakePanel.tsx', 'research-brief.ts']) {
  assert(
    Object.values(coverage.fileCoverageFor(resolve(root, name)).f).some((count) => count > 0),
    `expected UI execution missing from coverage: ${name}`,
  );
}
const summary = coverage.getCoverageSummary().toJSON();
writeFileSync('artifacts/ui-audit/combined-coverage.json', JSON.stringify(coverage.toJSON()));
writeFileSync('artifacts/ui-audit/combined-summary.json', JSON.stringify(summary, null, 2));
console.log('Combined app-owned unit and browser source coverage:', JSON.stringify(summary));
assert(
  ['statements', 'lines', 'functions', 'branches'].every((metric) => summary[metric].pct >= 98),
  'C2 remains open: full app coverage must reach 98% in every metric',
);
