# Judge untrusted code with tests it cannot touch, on Vercel Sandbox, step by step

Stood pays a builder when the buyer's frozen tests pass on the builder's exact commit. That only means something if the builder's code cannot fake the result. This guide shows how Stood runs untrusted code on [Vercel Sandbox](https://vercel.com/docs/vercel-sandbox) so that the payee cannot write the proof alone. Every step and every mistake below comes from our own runs on 2026-10-10.

- **What you get:** one disposable Firecracker microVM per run, the builder's code as one Linux user, the buyer's tests as another, and a verdict the code under test cannot reach.
- **Code:** [`services/api/src/adapters/runner/vercel-sandbox.ts`](../../services/api/src/adapters/runner/vercel-sandbox.ts), qualified by [`services/api/src/runner-check-cli.ts`](../../services/api/src/runner-check-cli.ts).
- **Decision record:** [ADR-0026](../adr/0026-isolated-code-runner-on-vercel-sandbox.md) and its amendment.

## The problem

The obvious design runs the buyer's tests with `node --test` inside the builder's project and treats exit code 0 as a pass. An external audit showed why that is not evidence. The tests import the builder's code, so the builder's code runs **inside the test process**, and from there it can:

- call `process.exit(0)` before any assertion runs (Node then reports one passing "test" named after the file);
- replace `node:assert`, or print the exact lines a parser looks for;
- rewrite a later test file on disk before it runs.

It is the reused-photo problem in code: the package reports the result the payee wanted.

## The design

| Part | Runs as | Can read | Can write |
| --- | --- | --- | --- |
| Builder's code (`/vercel/run`) | `nobody` (uid 65534), no capabilities, `no_new_privs` | its own code | nothing |
| Frozen tests and Stood's harness (`/vercel/judge`) | the judge (uid 65533) | the tests, the harness | nothing |
| Stood's worker (outside the VM) | — | the exit code of each test process | the signed report |

The tests reach the builder's code only through one function, `runBuilder(argv, { input })` from `stood-harness`. It starts the program as a **separate process** under the builder's identity and returns `{ status, stdout, stderr }`. The verdict is whether the judge's own process exited 0. The builder's code never runs in it.

## Step by step

### 1. Create the VM with the registry as the only destination

```ts
const session = await Sandbox.create({
  image: 'vercel/sandbox/node:24',
  resources: { vcpus: 1 },
  timeout: 600_000,
  persistent: false,
  networkPolicy: { allow: ['registry.npmjs.org'] },
});
```

`persistent: false` means nothing survives the run. Stop the VM in `finally`.

### 2. Write the code and the tests to different places

The builder's source goes to `/vercel/run`. The frozen tests and the harness go to `/vercel/judge` only, with the harness at `/vercel/judge/node_modules/stood-harness/index.mjs`, so a test can `import { runBuilder } from 'stood-harness'`.

### 3. Install dependencies, with scripts off

```ts
await session.runCommand({ cmd: 'npm', args: ['install', '--ignore-scripts', '--no-audit', '--no-fund'], cwd: '/vercel/run' });
```

A failed install fails the tests only when npm names the submission as broken (`ETARGET`, `E404`, …). A registry outage or rate limit is the runner's problem: the package waits.

### 4. Lock both directories, then prove the lock

```text
chown -R root:65534 /vercel/run && chmod -R u=rX,g=rX,o= /vercel/run
chown -R root:root  /vercel/judge && chmod -R a=rX /vercel/judge
```

Then, **as each identity**, try what must be refused: the builder creates a file in either directory or opens its code or a test for writing; the judge lists the builder's code or writes a test. Every attempt must fail before any test runs.

### 5. Cut the network

```ts
await session.update({ networkPolicy: 'deny-all' });
```

No DNS, nothing. The code under test runs offline.

### 6. Run each test as the judge

```text
setpriv --reuid=65533 --regid=65533 --clear-groups \
  --inh-caps=-all,+setuid,+setgid,+setpcap --ambient-caps=-all,+setuid,+setgid,+setpcap \
  --bounding-set=-all,+setuid,+setgid,+setpcap -- \
  env -i -C /vercel/judge PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp \
  timeout 120 node --test /vercel/judge/tests/booking.test.js
```

The judge keeps only the three capabilities needed to start the builder's program as `nobody`. The harness starts it with every capability dropped:

```text
setpriv --reuid=65534 --regid=65534 --clear-groups --inh-caps=-all --ambient-caps=-all \
  --bounding-set=-all --no-new-privs -- env -i -C /vercel/run PATH=... HOME=/tmp node src/cli.js 10:00
```

Exit code 0 from the judge's process is a PASS. Anything else is a FAIL, named by the test's id.

### 7. Sign outside the VM

The worker signs the per-test results with its own Ed25519 key, which never enters the VM, and stores the signed run in Stood's evidence bucket before anything is decided.

## Writing a test for the judge

```js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runBuilder } from 'stood-harness';

test('a slot can be booked', () => {
  const run = runBuilder(['node', 'src/cli.js', '10:00']);
  assert.equal(run.status, 0);
  assert.equal(run.stdout, 'booked 10:00\n');
});
```

Import nothing else: no `../src`, no `fs`, no dynamic `import()` or `require`. The Foreman refuses any planned test that does. Our sandbox repository has a working example on the branches `e2e/judge-base`, `e2e/judge-pass` and `e2e/judge-fail` of [`ma-za-kpe/yard-sandbox`](https://github.com/ma-za-kpe/yard-sandbox).

## Qualify it

```bash
scripts/dev runner-check
```

Real output on 2026-10-10 (142 seconds):

```text
ok  pass        PASS (expected PASS)
ok  fail        FAIL (expected FAIL)
ok  dependency  PASS (expected PASS)
ok  no-network  PASS (expected PASS)
ok  no-secrets  PASS (expected PASS)
ok  identity    PASS (expected PASS)
ok  runaway     FAIL (expected FAIL)
ok  exit-early  FAIL (expected FAIL)
ok  forged      FAIL (expected FAIL)
ok  tamper      PASS (expected PASS)
ok  no-import   PASS (expected PASS)
```

`exit-early` and `forged` are the builder's attacks: exiting 0 before doing the work, and printing a fake test report. Both fail, because they happen in the builder's process, not the judge's. `tamper` passes because the builder's attempts to write the tests, the harness or itself, to signal the judge, and to read the judge's memory or environment were all refused.

## Mistakes we made, and the fixes

1. **Exit code 0 was the verdict.** Probed on Node 24: `process.exit(0)` before the assertions, `process.exit(0)` in the middle, and a file with no tests all print `ok 1 - <file>` and `# pass 1`. Parsing the report better was not the fix; moving the code under test out of the test process was.
2. **"Non-root" was not unprivileged.** The sandbox's default user (uid 1000) holds **every** Linux capability (`CapEff: 000001ffffffffff`), including the one that ignores file permissions. Our read-only lock did nothing against it, and `test -w` still said "not writable". Check `/proc/self/status`, and drop capabilities explicitly with `setpriv`.
3. **A shell probe that lied.** In `dash`, a failed redirection on the `:` builtin (`: >> file`) ends the whole shell, so a refused write made our probe fail for the wrong reason. Run the write in a subshell: `(: >> "$0")`.
4. **The judge could not start the builder.** `spawn` with `cwd: '/vercel/run'` failed with `EACCES`, because the judge is not allowed into the builder's directory, which is the point. The builder changes directory itself after switching user (`env -C /vercel/run`).
5. **Dropping the bounding set needs a capability.** The judge's `setpriv --bounding-set=-all` for the builder failed until the judge kept `CAP_SETPCAP`.
6. **A test that never ran tests.** A file with no tests exits 0. The baseline catches it: before work is posted, every frozen test must fail on the base commit, and a test with nothing in it does not.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `RUNNER_UNAVAILABLE:LOCK` | An identity was not refused, or `chown`/`chmod` failed | Run the probe commands by hand in `sandbox connect`, as that identity |
| Every test FAILs, `install exit 1` | npm named the submission as broken | Read the npm error code; fix `package.json` |
| `WAIT:RUNNER_UNAVAILABLE:INSTALL` | Registry unreachable or throttled | Nothing to fix in the code; the package is tried again with backoff |
| `spawnSync setpriv EACCES` in a test | A `cwd` the judge cannot enter | Do not pass `cwd`; the harness changes directory as the builder |

## Remaining limits

- The judge's tests are trusted code: the Foreman writes them and the buyer accepts them. They hold three capabilities so they can start the builder's program.
- Vercel names managed images by tag, so a signed report identifies the configuration that ran (image tag, SDK version, harness), not a content digest of the image.

## Cost

One vCPU for about two minutes per run (`runner-check` runs eleven test files in one VM). Data the VM downloads (npm) is free.
