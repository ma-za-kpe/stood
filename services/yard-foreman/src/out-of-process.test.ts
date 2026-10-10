import { expect, it } from 'vitest';
import { outOfProcess } from './foreman.js';

const harness =
  "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { runBuilder } from 'stood-harness';\n";
// Owner decision 2026-10-10: a frozen test reaches the builder's code only as a separate process.
it('accepts a test that drives the program through the harness, and nothing that loads code in-process', () => {
  expect(
    outOfProcess(`${harness}test('adds', () => assert.equal(runBuilder(['node', 'src/cli.js']).stdout, '5\\n'));`),
  ).toBe(true);
  for (const bad of [
    "import assert from 'node:assert/strict';\nassert.equal(1, 1);",
    `${harness}import { add } from '../src/add.js';`,
    `${harness}import fs from 'node:fs';`,
    `${harness}import 'left-pad';`,
    `${harness}const m = await import('../src/add.js');`,
    `${harness}const m = require('../src/add.js');`,
    `${harness}import { spawnSync } from "node:child_process";`,
  ])
    expect(outOfProcess(bad), bad).toBe(false);
});
