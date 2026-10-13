import { createHash, createHmac, randomBytes } from 'node:crypto';
import { GitHubRepositoryReader } from './adapters/github/repository-reader.js';
import { KernelSandboxApprover } from './adapters/kernel/sandbox-approver.js';
import { bundleHash } from './application/code-evidence.js';

// T-0384 operator qualification: sign v1, amend only evidence terms, sign v2, then fund and execute under v2.
// Every PayPal action is against the sandbox. Output contains identifiers and states, never credentials or links.
const env = process.env;
const base = (env.STOOD_API_URL?.trim() || 'https://stood-api.onrender.com').replace(/\/$/, '');
const key = env.STOOD_API_KEY?.trim() ?? '';
const secret = env.STOOD_HMAC_SECRET?.trim() ?? '';
const payee = env.STOOD_SANDBOX_PAYEE_ID?.trim() ?? '';
const repository = 'ma-za-kpe/yard-sandbox';
const baseCommit = '8bf97d5c62cfa1a32fbb26573376f9ab560aba1b';
const passing = '5ba5a5a4f65a929f6cac039c379fc48d9bb736ee';
const run = new Date().toISOString().replace(/[:.]/g, '-');
const events: Record<string, unknown>[] = [];
const log = (line: string) => process.stdout.write(`${line}\n`);
const note = (step: string, detail: Record<string, unknown>) => {
  events.push({ at: new Date().toISOString(), step, ...detail });
  log(`${step}: ${JSON.stringify(detail)}`);
};
if (!key || !secret || !/^[A-Z0-9]{13}$/.test(payee)) {
  log('STOOD_API_KEY, STOOD_HMAC_SECRET and a sandbox STOOD_SANDBOX_PAYEE_ID are required (from .env).');
  process.exit(2);
}

async function call(method: 'GET' | 'POST', path: string, body?: unknown, idempotency = '') {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const raw = body === undefined ? '' : JSON.stringify(body);
  const signature = createHmac('sha256', secret)
    .update(
      JSON.stringify(['stood.request@2', timestamp, method, `/v1${path}`, idempotency, '', 'application/json', raw]),
    )
    .digest('hex');
  const response = await fetch(`${base}/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      'Stood-Signature': `t=${timestamp},v2=${signature}`,
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
async function until<T>(what: string, read: () => Promise<T>, done: (value: T) => boolean, minutes = 15): Promise<T> {
  const end = Date.now() + minutes * 60_000;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 15_000));
  }
}

const openapi = await fetch(`${base}/v1/openapi.json`, { signal: AbortSignal.timeout(15_000) });
if (!openapi.ok || (await openapi.json()).info?.version !== '1.5.0')
  throw new Error('Hosted API is not the expected 1.5.0 versioned-allowance release.');
const healthResponse = await fetch(`${base}/health`, { signal: AbortSignal.timeout(15_000) });
const health = (await healthResponse.json()) as {
  paymentReady?: boolean;
  providers?: { provider?: string; mode?: string; ready?: boolean }[];
};
if (
  !healthResponse.ok ||
  !health.paymentReady ||
  !health.providers?.some((p) => p.provider === 'paypal' && p.ready && p.mode === 'live')
)
  throw new Error('Hosted PayPal sandbox funding is not ready; no allowance was created.');
note('preflight', { apiVersion: '1.5.0', sandboxPaymentsReady: true });

const testsV1 = [{ id: 'booking-v1', path: 'tests/booking.test.js' }];
const testsV2 = [{ id: 'booking-v2', path: 'tests/booking.test.js' }];
const reader = new GitHubRepositoryReader();
const frozen = await reader.files(
  repository,
  baseCommit,
  testsV1.map((test) => test.path),
);
const common = {
  repository,
  baseCommit,
  testBundleHash: bundleHash(frozen),
};
const terms = (tests: typeof testsV1) => ({
  ...common,
  manifestHash: createHash('sha256').update(JSON.stringify(tests)).digest('hex'),
  testIds: tests.map((test) => test.id),
  tests,
});
const initialTerms = terms(testsV1);
const amendedTerms = terms(testsV2);
const baseline = await call('POST', '/baselines', initialTerms, `allowance-version-baseline-${run}`);
const baselineResult = await until(
  'version-one baseline',
  () => call('GET', `/baselines/${String(baseline.id)}`),
  (result) => result.status !== 'QUEUED',
);
if (
  baselineResult.status !== 'DONE' ||
  !(baselineResult.tests as { status: string }[]).every((test) => test.status === 'FAIL')
)
  throw new Error('The buyer test is not red on the signed base commit.');
note('baseline', { id: baseline.id, status: baselineResult.status, tests: baselineResult.tests });

const milestone = (params: typeof initialTerms) => ({
  name: 'versioned-work',
  amount: { minor: 100, currency: 'USD' },
  profile: 'code.milestone@1',
  params,
});
const allowance = await call(
  'POST',
  '/allowances',
  {
    payee_ref: payee,
    cap: { minor: 100, currency: 'USD' },
    milestones: [milestone(initialTerms)],
    window_days: 7,
    max_resubmits: 0,
  },
  `allowance-version-allowance-${run}`,
);
const allowanceId = String(allowance.id);
const trancheId = String((allowance.tranches as { id: string; name: string }[])[0]?.id ?? '');
if (!allowanceId || !trancheId) throw new Error('Allowance creation returned no tranche.');
note('allowance', { id: allowanceId, trancheId });

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
              goto: (url) => page.goto(url),
              waitForSelector: (selector, options) => page.waitForSelector(selector, options),
              isVisible: (selector) => page.isVisible(selector),
              fill: (selector, value) => page.fill(selector, value),
              click: (selector) => page.click(selector),
              url: () => page.url(),
              waitForURL: (test, options) => page.waitForURL(test, options),
            },
            close: () => browser.close(),
          };
        },
      })
    : null;
const approve = async (url: string) => {
  if (!kernel) throw new Error('Kernel and sandbox buyer credentials are required for approval.');
  note('kernel', { approving: new URL(url).host });
  await kernel.approve(url);
};
const signVersion = async (version: 1 | 2) => {
  const idempotency = `allowance-version-mandate-v${version}-${run}`;
  await call(
    'POST',
    version === 1 ? `/allowances/${allowanceId}/mandate` : `/allowances/${allowanceId}/versions/2/mandate`,
    {},
    idempotency,
  );
  const pending = await until(
    `version ${version} signing approval`,
    () => call('GET', `/allowances/${allowanceId}/mandate/${idempotency}`),
    (value) => value.status === 'AWAITING_APPROVAL' || value.status === 'SIGNED' || value.status === 'REVOKED',
  );
  if (pending.status === 'AWAITING_APPROVAL') await approve(String(pending.approve_url));
  const signed = await until(
    `version ${version} signed consent`,
    () => call('GET', `/allowances/${allowanceId}/mandate/${idempotency}`),
    (value) => value.status === 'SIGNED' || value.status === 'REVOKED' || value.status === 'FAILED',
  );
  if (signed.status !== 'SIGNED') throw new Error(`Version ${version} consent ended in ${String(signed.status)}.`);
  note('mandate', { version, status: signed.status });
};
await signVersion(1);

const amended = await call(
  'POST',
  `/allowances/${allowanceId}/versions`,
  {
    expected_version: 1,
    terms: {
      payee_ref: payee,
      cap: { minor: 100, currency: 'USD' },
      milestones: [milestone(amendedTerms)],
      window_days: 7,
      max_resubmits: 0,
    },
  },
  `allowance-version-amendment-${run}`,
);
const versionTwo = await call('GET', `/allowances/${allowanceId}/versions/2`);
if (amended.version !== 2 || versionTwo.version !== 2 || versionTwo.terms_hash !== amended.terms_hash)
  throw new Error('The durable version-two proposal could not be read back consistently.');
note('amendment', { version: amended.version, termsHash: amended.terms_hash });
await signVersion(2);

const signedVersion = await call('GET', `/allowances/${allowanceId}/versions/2`);
if (signedVersion.terms_hash !== versionTwo.terms_hash) throw new Error('Version-two terms changed after consent.');
const tranche = await call('GET', `/tranches/${trancheId}`);
const fundingKey = `allowance-version-funding-v2-${run}`;
await call(
  'POST',
  `/tranches/${trancheId}/funding`,
  {
    expected_version: tranche.version,
    nonce: Array.from(randomBytes(3), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join(''),
  },
  fundingKey,
);
const pendingFunding = await until(
  'version-two PayPal funding approval',
  () => call('GET', `/tranches/${trancheId}/funding/${fundingKey}`),
  (value) => ['AWAITING_APPROVAL', 'HELD', 'FAILED', 'EXPIRED'].includes(String(value.status)),
);
if (pendingFunding.status === 'AWAITING_APPROVAL') await approve(String(pendingFunding.approve_url));
const held = await until(
  'version-two funding hold',
  () => call('GET', `/tranches/${trancheId}/funding/${fundingKey}`),
  (value) => ['HELD', 'FAILED', 'EXPIRED'].includes(String(value.status)),
);
if (held.status !== 'HELD') throw new Error(`Version-two funding ended in ${String(held.status)}.`);
note('funding', { termsVersion: 2, status: held.status, amountMinor: 100, currency: 'USD' });

const pkg = await call(
  'POST',
  `/tranches/${trancheId}/packages`,
  {
    repository,
    base_commit: baseCommit,
    commit_sha: passing,
    report_ref: `allowance-version-e2e/${run}.json`,
    report_sha256: createHash('sha256').update(`${run}:${passing}`).digest('hex'),
  },
  `allowance-version-package-${run}`,
);
note('package', { id: pkg.id, commit: passing });
const decision = await until(
  'version-two runner and settlement decision',
  () => call('GET', `/tranches/${trancheId}`),
  (value) => ['RELEASED', 'REFUSED', 'WAITING', 'EXPIRED', 'CANCELLED', 'DISPUTED'].includes(String(value.state)),
  25,
);
const settlement = decision.settlement as { effect?: string; reference?: string } | null;
note('decision', {
  state: decision.state,
  settlement: settlement?.effect ?? null,
  captureReference: settlement?.reference ?? null,
});
if (decision.state !== 'RELEASED' || settlement?.effect !== 'CAPTURE' || !settlement.reference)
  throw new Error(`Version-two work ended in ${String(decision.state)} without a confirmed capture.`);

log(
  `RECORDING ${JSON.stringify({ run, base, repository, allowance: allowanceId, tranche: trancheId, version: 2, termsHash: versionTwo.terms_hash, package: pkg.id, events })}`,
);
log('Versioned allowance end-to-end: version 2 CAPTURED after explicit version-two consent.');
