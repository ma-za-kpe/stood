import { createHash, createHmac, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import { GitHubRepositoryReader } from './adapters/github/repository-reader.js';
import { KernelSandboxApprover } from './adapters/kernel/sandbox-approver.js';
import { bundleHash } from './application/code-evidence.js';
import { existingYardMandate, qualifiedYardPayment } from './application/yard-qualification.js';

// T-0189: one final work order driven through the deployed Yard app's session proxy. Stood handles sandbox
// signing/funding; the builder submits and the buyer confirms usage through Yard. Never posts a Stood package,
// invented hold, decision or usage receipt. A $1 builder price plus the hosted Yard fee uses sandbox money only.
const env = process.env;
const yardOrigin = 'https://stood-yard-api.onrender.com';
const stoodOrigin = 'https://stood-api.onrender.com';
const resume = process.argv[2] === '--resume' ? (process.argv[3] ?? '') : '';
if (resume && !/^yard-live-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/.test(resume))
  throw new Error('Invalid resume project');
const run = resume ? resume.slice('yard-live-'.length) : new Date().toISOString().replace(/[:.]/g, '-');
const directory = `.sandbox/yard-live/${run}`;
mkdirSync(directory, { recursive: true, mode: 0o700 });
const events: Record<string, unknown>[] = existsSync(`${directory}/record.json`)
  ? (JSON.parse(readFileSync(`${directory}/record.json`, 'utf8')) as { events: Record<string, unknown>[] }).events
  : [];
const note = (step: string, detail: Record<string, unknown>) => {
  events.push({ at: new Date().toISOString(), step, ...detail });
  writeFileSync(`${directory}/record.json`, JSON.stringify({ run, events }, null, 2), { mode: 0o600 });
  process.stdout.write(`${step}: ${JSON.stringify(detail)}\n`);
};
const object = (v: unknown) => v as Record<string, unknown>;
const operators = JSON.parse(env.YARD_OPERATORS ?? '[]') as {
  actor: { id: string; kind: string };
  accessCode?: string;
}[];
const buyer = operators.find((o) => o.actor.kind === 'BUYER' && o.accessCode);
const builder = operators.find((o) => o.actor.kind === 'BUILDER' && o.accessCode);
if (
  !buyer ||
  !builder ||
  !env.STOOD_API_KEY ||
  !env.STOOD_HMAC_SECRET ||
  !env.KERNEL_API_KEY ||
  !env.PAYPAL_SANDBOX_BUYER_EMAIL ||
  !env.PAYPAL_SANDBOX_BUYER_PASSWORD
)
  throw new Error('Missing sandbox qualification configuration');
async function response(method: string, path: string, r: Response): Promise<Record<string, unknown>> {
  const value = object(await r.json());
  if (!r.ok) throw new Error(`${method} ${path}: HTTP ${r.status} ${String(value.code ?? '')}`);
  return value;
}
async function session(accessCode: string) {
  const r = await fetch(`${yardOrigin}/app/api/session`, {
    method: 'POST',
    headers: { Origin: yardOrigin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_code: accessCode }),
    signal: AbortSignal.timeout(30_000),
  });
  await response('POST', '/app/api/session', r);
  const cookie = r.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('Hosted session did not set a cookie');
  return async (method: 'GET' | 'POST', path: string, body?: unknown, version?: number, key = '') => {
    const result = await fetch(`${yardOrigin}/app/api${path}`, {
      method,
      headers: {
        Cookie: cookie,
        Origin: yardOrigin,
        'Content-Type': 'application/json',
        ...(version === undefined ? {} : { 'If-Match': String(version) }),
        ...(key ? { 'Idempotency-Key': key } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(60_000),
    });
    return response(method, path, result);
  };
}
async function stood(method: 'GET' | 'POST', path: string, body?: unknown, key = '') {
  const raw = body === undefined ? '' : JSON.stringify(body),
    t = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', env.STOOD_HMAC_SECRET as string)
    .update(JSON.stringify(['stood.request@2', t, method, `/v1${path}`, key, '', 'application/json', raw]))
    .digest('hex');
  const r = await fetch(`${stoodOrigin}/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.STOOD_API_KEY}`,
      'Stood-Signature': `t=${t},v2=${signature}`,
      'Content-Type': 'application/json',
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    ...(raw ? { body: raw } : {}),
    signal: AbortSignal.timeout(60_000),
  });
  return response(method, path, r);
}
async function until(
  label: string,
  read: () => Promise<Record<string, unknown>>,
  done: (v: Record<string, unknown>) => boolean,
) {
  const end = Date.now() + 25 * 60_000;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() >= end) throw new Error(`Timed out: ${label}`);
    await setTimeout(15_000);
  }
}
const approver = new KernelSandboxApprover({
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
      },
      close: () => browser.close(),
    };
  },
});
try {
  const health = await response(
    'GET',
    '/health',
    await fetch(`${stoodOrigin}/health`, { signal: AbortSignal.timeout(30_000) }),
  );
  if (
    !health.paymentReady ||
    !(health.providers as { provider: string; simulated: boolean; ready: boolean }[]).some(
      (p) => p.provider === 'paypal' && p.simulated === false && p.ready,
    )
  )
    throw new Error('Real PayPal sandbox is not ready');
  const buy = await session(buyer.accessCode as string),
    build = await session(builder.accessCode as string);
  note('sessions', { buyer: true, builder: true, transport: 'hosted-app-session-api' });
  const repository = 'ma-za-kpe/yard-sandbox',
    baseCommit = '8bf97d5c62cfa1a32fbb26573376f9ab560aba1b';
  const commit = '5ba5a5a4f65a929f6cac039c379fc48d9bb736ee',
    tests = [{ id: 'booking', path: 'tests/booking.test.js' }];
  const frozen = await new GitHubRepositoryReader().files(
    repository,
    baseCommit,
    tests.map((t) => t.path),
  );
  const terms = {
    repository,
    baseCommit,
    tests,
    testIds: ['booking'],
    testBundleHash: bundleHash(frozen),
    manifestHash: createHash('sha256').update(JSON.stringify(tests)).digest('hex'),
  };
  let red: Record<string, unknown>;
  if (resume) {
    const recorded = events.find((e) => e.step === 'baseline');
    if (!recorded) throw new Error('Missing private baseline recording');
    red = await stood('GET', `/baselines/${recorded.id}`);
  } else {
    const baseline = await stood('POST', '/baselines', terms, `yard-live-baseline-${run}`);
    red = await until(
      'baseline',
      () => stood('GET', `/baselines/${baseline.id}`),
      (v) => v.status !== 'QUEUED',
    );
    if (
      red.status !== 'DONE' ||
      !(red.tests as { id: string; status: string }[]).some((t) => t.id === 'booking' && t.status === 'FAIL')
    )
      throw new Error('Real frozen baseline was not red');
    note('baseline', { id: red.id, status: red.status });
  }
  const id = `yard-live-${run}`,
    root = `/blueprints/${id}`,
    now = Date.now();
  const milestones = [
    {
      id: 'final',
      name: 'Hosted Yard booking',
      budgetMinor: 100,
      deadline: now + 7 * 86400000,
      profileId: 'code.final@1',
      testIds: terms.testIds,
      tests,
      testBundleHash: terms.testBundleHash,
      manifestHash: terms.manifestHash,
    },
  ];
  if (!resume)
    await buy(
      'POST',
      '/blueprints',
      {
        id,
        buyerOperatorId: buyer.actor.id,
        repository,
        baseCommit,
        summary: 'Hosted Yard sandbox qualification',
        capMinor: 100,
        currency: 'USD',
        milestones,
      },
      undefined,
      `${run}:create`,
    );
  const room = () => buy('GET', `${root}/room`);
  const write = async (actor: typeof buy, path: string, body: unknown, key: string) =>
    actor('POST', path, body, Number((await room()).version), `${run}:${key}`);
  note('project', { id });
  if (!(await room()).signed)
    await write(
      buy,
      `${root}/approve`,
      {
        version: 1,
        buyerOperatorId: buyer.actor.id,
        approvalReference: `hosted-buyer:${run}`,
        baselines: [
          {
            milestoneId: 'final',
            testBundleHash: terms.testBundleHash,
            manifestHash: terms.manifestHash,
            failedTestIds: ['booking'],
            reference: String(red.id),
          },
        ],
      },
      'approve',
    );
  const snapshot = await buy('GET', root);
  const data = object(snapshot.data),
    blueprint = object(data.blueprint);
  if (blueprint.repository !== repository || blueprint.baseCommit !== baseCommit)
    throw new Error('Unexpected resume terms');
  const mandate = existingYardMandate(data.mandate) ?? (await write(buy, `${root}/mandate`, {}, 'draft'));
  const allowanceId = String(mandate.allowanceId),
    trancheId = String(object(mandate.tranches).final);
  const amount = (await stood('GET', `/tranches/${trancheId}`)).amount as { minor: number; currency: string };
  note('allowance', { id: allowanceId, trancheId, amount });
  const signingKey = `${run}:sign`;
  // Replaying the same reservation also recovers an interruption before its first response was recorded.
  await stood('POST', `/allowances/${allowanceId}/mandate`, {}, signingKey);
  const signing = await until(
    'signing link',
    () => stood('GET', `/allowances/${allowanceId}/mandate/${signingKey}`),
    (v) => ['AWAITING_APPROVAL', 'SIGNED', 'REVOKED'].includes(String(v.status)),
  );
  if (signing.status === 'AWAITING_APPROVAL') await approver.approve(String(signing.approve_url));
  const signed = await until(
    'signed mandate',
    () => stood('GET', `/allowances/${allowanceId}/mandate/${signingKey}`),
    (v) => ['SIGNED', 'REVOKED'].includes(String(v.status)),
  );
  if (signed.status !== 'SIGNED') throw new Error('Mandate refused');
  note('mandate', { status: signed.status });
  const tranche = await stood('GET', `/tranches/${trancheId}`),
    fundingKey = `${run}:fund`;
  const nonce = Array.from(randomBytes(3), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
  if (!tranche.hold) {
    await stood('POST', `/tranches/${trancheId}/funding`, { expected_version: tranche.version, nonce }, fundingKey);
    const funding = await until(
      'funding',
      () => stood('GET', `/tranches/${trancheId}/funding/${fundingKey}`),
      (v) => ['AWAITING_APPROVAL', 'HELD', 'FAILED', 'EXPIRED'].includes(String(v.status)),
    );
    if (funding.status === 'AWAITING_APPROVAL') await approver.approve(String(funding.approve_url));
    const held = await until(
      'hold',
      () => stood('GET', `/tranches/${trancheId}/funding/${fundingKey}`),
      (v) => ['HELD', 'FAILED', 'EXPIRED'].includes(String(v.status)),
    );
    if (held.status !== 'HELD') throw new Error('Funding failed');
    note('hold', { status: held.status });
  }
  if (!(object(await room()).orders as { id: string }[]).some((o) => o.id === 'final'))
    await write(buy, `${root}/work-orders`, { milestone: 'final' }, 'post');
  // The buyer owns the work order before a builder claims it; builder-private reads require that claim.
  const work = () => buy('GET', `${root}/work-orders/final`);
  if ((await work()).state === 'POSTED') await write(build, `${root}/work-orders/final/claim`, {}, 'claim');
  await until('Yard hold projection', work, (v) => !!v.hold);
  if ((await work()).state === 'CLAIMED') await write(build, `${root}/work-orders/final/build`, {}, 'build');
  if ((await work()).state === 'BUILDING') await write(build, `${root}/work-orders/final/submit`, { commit }, 'submit');
  const submitted = await work(),
    packageId = String(object(submitted.submission).packageId);
  if (!packageId || packageId === 'undefined') throw new Error('Yard did not submit a package');
  note('package', { id: packageId, commit });
  const judged = await until(
    'usage wait',
    () => stood('GET', `/tranches/${trancheId}`),
    (v) => ['WAITING', 'RELEASED', 'REFUSED'].includes(String(v.state)),
  );
  if (
    judged.state !== 'RELEASED' &&
    (judged.state !== 'WAITING' ||
      !['usage_pending', 'missing_result:usage_release'].includes(String(object(judged.decision).reason)))
  )
    throw new Error('Final milestone did not wait for usage');
  note('decision', {
    state: judged.state,
    outcome: object(judged.decision).outcome,
    namedField: object(judged.decision).namedField,
  });
  if (judged.state !== 'RELEASED' && !(await work()).usage)
    await write(buy, `${root}/work-orders/final/usage`, {}, 'usage');
  const released = await until(
    'capture',
    () => stood('GET', `/tranches/${trancheId}`),
    (v) => ['RELEASED', 'REFUSED'].includes(String(v.state)),
  );
  const paid = await until('Yard payment projection', work, (v) => v.state === 'PAID');
  if (!qualifiedYardPayment({ trancheId, packageId, ...amount }, released, paid))
    throw new Error('Payment facts do not match');
  note('qualified', {
    projectId: id,
    allowanceId,
    trancheId,
    packageId,
    state: paid.state,
    settlement: released.settlement,
    amount,
    usage: 'ACCEPTED',
    transport: 'hosted-app-session-api',
  });
} catch (error) {
  // Only errors constructed by this tool are printed; external errors can include credentials or personal details.
  note('incomplete', {
    reason:
      error instanceof Error &&
      /^(GET|POST|Timed out|Real |Final |Payment |Yard |Funding |Mandate )/.test(error.message)
        ? error.message
        : 'Qualification stopped; reconcile the private recording before retrying',
  });
  process.exitCode = 1;
}
