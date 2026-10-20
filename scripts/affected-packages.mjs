#!/usr/bin/env node

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const roots = ['apps', 'packages', 'services'];
const workspaces = roots.flatMap((root) =>
  readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const directory = join(root, entry.name);
      try {
        const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
        return { directory: directory.replaceAll(sep, '/'), name: manifest.name, manifest };
      } catch {
        return undefined;
      }
    })
    .filter(Boolean),
);
const byName = new Map(workspaces.map((workspace) => [workspace.name, workspace]));
const paths = process.argv.slice(2).map((path) => path.replaceAll('\\', '/'));

if (paths.length === 0) {
  process.stdout.write('full::No changed paths were available; use the full gate.\n');
  process.exit(0);
}

const changed = new Set();
for (const path of paths) {
  const owner = workspaces
    .filter((workspace) => path === workspace.directory || path.startsWith(`${workspace.directory}/`))
    .sort((a, b) => b.directory.length - a.directory.length)[0];
  if (!owner) {
    process.stdout.write(`full::Changed path has no workspace owner (${path}); use the full gate.\n`);
    process.exit(0);
  }
  changed.add(owner.name);
}

const dependents = new Map(workspaces.map(({ name }) => [name, new Set()]));
for (const { name, manifest } of workspaces) {
  const declared = [manifest.dependencies, manifest.devDependencies, manifest.optionalDependencies, manifest.peerDependencies];
  for (const section of declared) {
    for (const dependency of Object.keys(section ?? {})) {
      if (byName.has(dependency)) dependents.get(dependency).add(name);
    }
  }
}

const selected = new Set(changed);
const queue = [...changed];
while (queue.length) {
  for (const dependent of dependents.get(queue.shift()) ?? []) {
    if (!selected.has(dependent)) {
      selected.add(dependent);
      queue.push(dependent);
    }
  }
}

process.stdout.write(`${[...selected].sort().join('\n')}\n`);
