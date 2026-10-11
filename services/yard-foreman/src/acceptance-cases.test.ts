import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { acceptanceCases, renderAcceptanceTest } from './acceptance-cases.js';

const booking = {
  name: 'books a slot',
  args: ['book', '10:00'],
  input: '',
  status: 0,
  output: 'booked 10:00\n',
  match: 'exact' as const,
};

// Second audit (2026-10-11): import checks were bypassable ("// import 'stood-harness'", "import /* */ ('node:fs')",
// process.getBuiltinModule). The Foreman now writes data only; every frozen test file is this one template.
describe('acceptance cases', () => {
  it('accepts exactly the case format, and nothing that could carry code', () => {
    expect(acceptanceCases([booking])).toEqual([booking]);
    for (const bad of [
      [],
      [{ ...booking, code: "process.getBuiltinModule('child_process')" }],
      [{ ...booking, status: 1.5 }],
      [{ ...booking, status: 256 }],
      [{ ...booking, args: [1] }],
      [{ ...booking, match: 'regex' }],
      [{ ...booking, match: 'includes', output: '' }],
      [{ ...booking, name: '' }],
      [booking, booking],
      "import 'stood-harness';\nconst fs = await import /* bypass */ ('node:fs');",
      Array.from({ length: 21 }, (_, i) => ({ ...booking, name: `case ${i}` })),
    ])
      expect(acceptanceCases(bad), JSON.stringify(bad).slice(0, 80)).toBeNull();
  });

  it('renders a test whose text cannot be changed by the case data', () => {
    const hostile = { ...booking, name: "'); process.exit(0); ('", output: '`${process.exit(0)}`\n</script>' };
    const file = renderAcceptanceTest([hostile]);
    expect(file).toContain(JSON.stringify(hostile.name));
    expect(file.match(/^import /gm)).toEqual(['import ', 'import ', 'import ']);
    expect(renderAcceptanceTest([booking])).toBe(renderAcceptanceTest([booking]));
  });

  it('runs as a real node --test file against a program, red when the program is missing, green when it is right', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cases-'));
    mkdirSync(join(dir, 'node_modules', 'stood-harness'), { recursive: true });
    // A stand-in harness: the same contract as Stood's, without the identity switch.
    writeFileSync(
      join(dir, 'node_modules', 'stood-harness', 'package.json'),
      '{"name":"stood-harness","type":"module","exports":"./index.mjs"}',
    );
    writeFileSync(
      join(dir, 'node_modules', 'stood-harness', 'index.mjs'),
      `import { spawnSync } from 'node:child_process';\nexport const runBuilder = (command, { input = '' } = {}) => { const r = spawnSync(command[0], command.slice(1), { input, encoding: 'utf8', cwd: ${JSON.stringify(dir)} }); return { status: r.status, signal: r.signal, stdout: r.stdout, stderr: r.stderr }; };\n`,
    );
    const test = join(dir, 'booking.test.mjs');
    writeFileSync(test, renderAcceptanceTest([booking]));
    const run = () => spawnSync('node', ['--test', test], { encoding: 'utf8', cwd: dir }).status;
    expect(run()).not.toBe(0);
    mkdirSync(join(dir, 'src'));
    writeFileSync(
      join(dir, 'src', 'cli.js'),
      "console.log(process.argv[2] === 'book' ? `booked ${process.argv[3]}` : 'no');\n",
    );
    expect(run()).toBe(0);
  });
});
