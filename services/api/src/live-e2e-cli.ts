import { createHash, createHmac, createPrivateKey, randomBytes, sign } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import { GitHubRepositoryReader } from './adapters/github/repository-reader.js';
import { KernelSandboxApprover } from './adapters/kernel/sandbox-approver.js';
import { bundleHash } from './application/code-evidence.js';
import { receiptPayload } from './domain/usage-receipt.js';

// Operator tool (C4 #77): one live end-to-end run against the deployed Stood API on the PayPal SANDBOX, the way a
// platform drives it. Three code milestones on ma-za-kpe/yard-sandbox share one frozen test:
//   one   a passing commit  -> the Vercel runner releases it, the reconciler captures
//   two   a failing commit  -> refused, the reconciler voids
//   final a passing commit  -> waits for usage; a signed usage receipt releases it, the reconciler captures
// Kernel approves the buyer's PayPal steps unattended. Prints ids and states only; writes a JSON recording.
const env = process.env;
const base = (env.STOOD_API_URL?.trim() || 'https://stood-api.onrender.com').replace(/\/$/, '');
const key = env.STOOD_API_KEY?.trim() ?? '';
const secret = env.STOOD_HMAC_SECRET?.trim() ?? '';
const repository = 'ma-za-kpe/yard-sandbox';
const baseCommit = '692951b1a7030c00759bb7f6244d483925f9ce63';
const passing = '48ee3f847072163ab162c673567ad618f0ca9acb';
const failing = '1c11267d9e3bbcb5c4c66d362535a594081a1f2d';
const run = new Date().toISOString().replace(/[:.]/g, '-');
const log = (line: string) => process.stdout.write(`${line}\n`);
const events: unknown[] = [];
const note = (step: string, detail: Record<string, unknown>) => {
  events.push({ at: new Date().toISOString(), step, ...detail });
  log(`${step}: ${JSON.stringify(detail)}`);
};
if (!key || !secret || !/^[A-Z0-9]{13}$/.test(env.STOOD_SANDBOX_PAYEE_ID ?? '')) {
  log('STOOD_API_KEY, STOOD_HMAC_SECRET and STOOD_SANDBOX_PAYEE_ID (a sandbox merchant id) are required (from .env).');
  process.exit(2);
}

// A dropped connection is retried: every POST carries an idempotency key, so a retry is never a second effect.
async function call(method: 'GET' | 'POST', path: string, body?: unknown, idempotency = '') {
  for (let attempt = 1; ; attempt++) {
    try {
      return await once(method, path, body, idempotency);
    } catch (error) {
      if (!(error instanceof TypeError) || attempt >= 6) throw error;
      log(`network: ${error.message}; retrying ${method} ${path} (${attempt})`);
      await setTimeout(5_000 * attempt);
    }
  }
}
async function once(method: 'GET' | 'POST', path: string, body?: unknown, idempotency = '') {
  const t = String(Math.floor(Date.now() / 1000));
  const raw = body === undefined ? '' : JSON.stringify(body);
  const signature = createHmac('sha256', secret)
    .update(JSON.stringify(['stood.request@2', t, method, `/v1${path}`, idempotency, '', 'application/json', raw]))
    .digest('hex');
  const response = await fetch(`${base}/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      'Stood-Signature': `t=${t},v2=${signature}`,
      'Content-Type': 'application/json',
      ...(idempotency ? { 'Idempotency-Key': idempotency } : {}),
    },
    ...(raw ? { body: raw } : {}),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  const value = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status} ${String(value.code ?? '')}`);
  return value;
}
async function until<T>(what: string, read: () => Promise<T>, done: (v: T) => boolean, minutes = 15): Promise<T> {
  const end = Date.now() + minutes * 60_000;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await setTimeout(15_000);
  }
}

// The buyer's PayPal steps, approved unattended by a Kernel cloud browser on the sandbox.
const kernel =
  env.KERNEL_API_KEY && env.PAYPAL_SANDBOX_BUYER_EMAIL && env.PAYPAL_SANDBOX_BUYER_PASSWORD
    ? new KernelSandboxApprover({
        apiKey: env.KERNEL_API_KEY,
        buyerEmail: env.PAYPAL_SANDBOX_BUYER_EMAIL,
        buyerPassword: env.PAYPAL_SANDBOX_BUYER_PASSWORD,
        connect: async (cdp) => {
          const { chromium } = await import('playwright-core');
          const browser = await chromium.connectOverCDP(cdp);
          const context = browser.contexts()[0] ?? (await browser.newContext());
          const page = context.pages()[0] ?? (await context.newPage());
          return {
            page: {
              goto: (u) => page.goto(u),
              waitForSelector: (s, o) => page.waitForSelector(s, o),
              isVisible: (s) => page.isVisible(s),
              fill: (s, v) => page.fill(s, v),
              click: (s) => page.click(s),
              url: () => page.url(),
              waitForURL: (test, o) => page.waitForURL(test, o),
              capture: async (step) => {
                mkdirSync(`.sandbox/kernel/live-e2e-${run}`, { recursive: true });
                await page.screenshot({
                  path: `.sandbox/kernel/live-e2e-${run}/${step}.png`,
                  mask: [
                    page.locator('input[type=email], #email'),
                    page.getByText(env.PAYPAL_SANDBOX_BUYER_EMAIL ?? ''),
                  ],
                  maskColor: '#0b2545',
                });
              },
            },
            close: () => browser.close(),
          };
        },
      })
    : null;
const approve = async (link: string) => {
  if (!kernel) throw new Error('KERNEL_API_KEY and the sandbox buyer login are required for an unattended run.');
  note('kernel', { approving: new URL(link).host });
  await kernel.approve(link);
};

// 1. The buyer's frozen test at the base commit, exactly as the runner will read it.
const reader = new GitHubRepositoryReader();
const tests = [{ id: 'booking', path: 'tests/booking.test.js' }];
const frozen = await reader.files(
  repository,
  baseCommit,
  tests.map((t) => t.path),
);
const terms = {
  repository,
  baseCommit,
  testBundleHash: bundleHash(frozen),
  manifestHash: createHash('sha256').update(JSON.stringify(tests)).digest('hex'),
  testIds: tests.map((t) => t.id),
  tests,
};
note('terms', { repository, baseCommit, testBundleHash: terms.testBundleHash });

// 2. A baseline: the frozen test must fail on the base commit.
const baseline = await call('POST', '/baselines', terms, `live-e2e-baseline-${run}`);
note('baseline', { id: baseline.id, status: baseline.status });
const red = await until(
  'the baseline',
  () => call('GET', `/baselines/${String(baseline.id)}`),
  (b) => b.status !== 'QUEUED',
);
note('baseline', { id: red.id, status: red.status, tests: red.tests });
if (red.status !== 'DONE' || !(red.tests as { status: string }[]).every((t) => t.status === 'FAIL'))
  throw new Error('The frozen test is not red on the base commit.');

// 3. An allowance with three code milestones (USD sandbox amounts), or LIVE_ALLOWANCE to resume a signed one.
const resume = env.LIVE_ALLOWANCE?.trim() ?? '';
let draft: Record<string, unknown>;
if (resume) {
  draft = await call('GET', `/allowances/${resume}`);
  note('allowance', { id: draft.id, resumed: true });
} else {
  const milestone = (name: string, profile: string, minor: number) => ({
    name,
    amount: { minor, currency: 'USD' },
    profile,
    params: terms,
  });
  draft = await call(
    'POST',
    '/allowances',
    {
      // The PayPal sandbox merchant that receives the money: Stood sends payee_ref to PayPal as the payee.
      payee_ref: env.STOOD_SANDBOX_PAYEE_ID ?? '',
      cap: { minor: 600, currency: 'USD' },
      milestones: [
        milestone('one', 'code.milestone@1', 200),
        milestone('two', 'code.milestone@1', 200),
        milestone('final', 'code.final@1', 200),
      ],
      window_days: 7,
      max_resubmits: 1,
    },
    `live-e2e-allowance-${run}`,
  );
  note('allowance', { id: draft.id });

  // 4. The buyer signs the allowance once (saved PayPal), then each milestone is held.
  const mandateKey = `live-e2e-mandate-${run}`;
  await call('POST', `/allowances/${String(draft.id)}/mandate`, {}, mandateKey);
  const awaiting = await until(
    'the signing link',
    () => call('GET', `/allowances/${String(draft.id)}/mandate/${mandateKey}`),
    (m) => m.status === 'AWAITING_APPROVAL' || m.status === 'SIGNED',
  );
  if (awaiting.status === 'AWAITING_APPROVAL') await approve(String(awaiting.approve_url));
  const signed = await until(
    'the signed mandate',
    () => call('GET', `/allowances/${String(draft.id)}/mandate/${mandateKey}`),
    (m) => m.status === 'SIGNED' || m.status === 'REVOKED',
  );
  note('mandate', { status: signed.status });
  if (signed.status !== 'SIGNED') throw new Error('The allowance was not signed.');
}
const tranches = Object.fromEntries((draft.tranches as { id: string; name: string }[]).map((t) => [t.name, t.id]));
note('tranches', tranches);
const nonce = () => Array.from(randomBytes(3), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
for (const [name, trancheId] of Object.entries(tranches)) {
  const tranche = await call('GET', `/tranches/${trancheId}`);
  if (tranche.hold) {
    note('hold', { milestone: name, status: 'HELD', resumed: true });
    continue;
  }
  const fundingKey = `live-e2e-funding-${name}-${run}`;
  try {
    await call(
      'POST',
      `/tranches/${trancheId}/funding`,
      { expected_version: tranche.version, nonce: nonce() },
      fundingKey,
    );
  } catch (error) {
    // A hold an interrupted run already asked for: wait for that one instead of asking twice.
    if (!String(error).includes(' 409 ')) throw error;
    const earlier = await until(
      `the earlier ${name} hold`,
      () => call('GET', `/tranches/${trancheId}`),
      (t) => !!t.hold,
    );
    note('hold', { milestone: name, status: 'HELD', state: earlier.state, earlier: true });
    continue;
  }
  const pending = await until(
    `the ${name} hold`,
    () => call('GET', `/tranches/${trancheId}/funding/${fundingKey}`),
    (f) => ['AWAITING_APPROVAL', 'HELD', 'FAILED', 'EXPIRED'].includes(String(f.status)),
  );
  if (pending.status === 'AWAITING_APPROVAL') await approve(String(pending.approve_url));
  const held = await until(
    `the ${name} hold`,
    () => call('GET', `/tranches/${trancheId}/funding/${fundingKey}`),
    (f) => ['HELD', 'FAILED', 'EXPIRED'].includes(String(f.status)),
  );
  note('hold', { milestone: name, status: held.status });
  if (held.status !== 'HELD') throw new Error(`The ${name} hold failed.`);
}

// 5. Work is submitted: passing, failing, passing. Stood's own runner judges each on its exact commit.
const packages: Record<string, string> = {};
for (const [name, commit] of [
  ['one', passing],
  ['two', failing],
  ['final', passing],
] as const) {
  const trancheId = tranches[name] as string;
  const pkg = await call(
    'POST',
    `/tranches/${trancheId}/packages`,
    {
      repository,
      base_commit: baseCommit,
      commit_sha: commit,
      report_ref: `live-e2e/${name}.json`,
      report_sha256: createHash('sha256').update(`${name}:${commit}`).digest('hex'),
    },
    `live-e2e-package-${name}-${run}`,
  );
  packages[name] = String(pkg.id);
  note('package', { milestone: name, id: pkg.id, commit });
}
const settled = (s: string) => ['RELEASED', 'REFUSED', 'WAITING', 'EXPIRED', 'CANCELLED', 'DISPUTED'].includes(s);
const final: Record<string, Record<string, unknown>> = {};
for (const name of ['one', 'two', 'final']) {
  final[name] = await until(
    `the ${name} decision`,
    () => call('GET', `/tranches/${tranches[name]}`),
    (t) => settled(String(t.state)),
    25,
  );
  note('decided', {
    milestone: name,
    state: final[name].state,
    decision: (final[name].decision as { outcome?: string; namedField?: string } | null) ?? null,
  });
}

// 6. The buyer confirms use of the final milestone; the platform signs the receipt with its usage key.
const usageKey = createPrivateKey(Buffer.from(env.YARD_USAGE_SIGNING_KEY ?? '', 'base64').toString('utf8'));
const unsigned = {
  version: 1 as const,
  allowanceId: String(draft.id),
  trancheId: tranches.final as string,
  commit: passing,
  authority: { keyId: env.YARD_USAGE_KEY_ID ?? '', root: 'yard-buyers' },
  observedAt: Date.now(),
  nonce: `live-e2e-${randomBytes(12).toString('hex')}`,
};
const receipt = {
  ...unsigned,
  signature: sign(null, Buffer.from(receiptPayload(unsigned)), usageKey).toString('base64'),
};
note('usage', await call('POST', `/tranches/${tranches.final}/usage`, receipt));
final.final = await until(
  'the final release',
  () => call('GET', `/tranches/${tranches.final}`),
  (t) => ['RELEASED', 'REFUSED', 'EXPIRED'].includes(String(t.state)),
  25,
);
note('decided', { milestone: 'final', state: final.final.state, decision: final.final.decision ?? null });

// The run record goes to stdout on one tagged line; scripts/dev saves it under services/api/test/scenarios/live/.
// This tool writes no network data to disk itself.
log(`RECORDING ${JSON.stringify({ run, base, repository, allowance: draft.id, tranches, packages, events })}`);
const expected = { one: 'RELEASED', two: 'REFUSED', final: 'RELEASED' } as const;
const ok = Object.entries(expected).every(([name, state]) => final[name]?.state === state);
log(
  ok
    ? 'Live end-to-end: one CAPTURED, two VOIDED, final CAPTURED after usage.'
    : 'Live end-to-end: unexpected outcome.',
);
process.exit(ok ? 0 : 1);
