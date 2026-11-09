import { createHmac } from 'node:crypto';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';

// Demo autopilot (mock network only). One click builds a prewritten project: for each task the
// simulated Crew claims and submits, Stood holds, checks and captures on the simulated PayPal
// sandbox, and Yard records the payment from Stood's signed webhook. No real money, no real keys.
if (process.env.NETWORK_MOCK !== 'true' || process.env.APP_ENV !== 'ci') throw new Error('Mock director refused');

const STEP_MS = Number(process.env.DEMO_STEP_MS ?? 1200);
const API = 'http://api:3000',
  YARD = 'http://yard-api:3001',
  CREW = 'http://crew:8081',
  PAYPAL = 'http://paypal-sim:8080';

// Prewritten tasks. The last milestone must be the final (usage) milestone; each is $10.00 because
// the simulated Stood money flow authorizes one fixed $10.00 hold per tranche.
const TASKS = [
  { name: 'Sign-up and login', test: 'auth-works' },
  { name: 'Booking calendar', test: 'booking-works' },
  { name: 'Payments page', test: 'checkout-works' },
  { name: 'Launch and hand over', test: 'launch-works' },
];
const BUDGET = 1000;

type Status = {
  projectId: string | null;
  running: boolean;
  task: number;
  total: number;
  step: string;
  paid: number;
  error: string | null;
};
let status: Status = {
  projectId: null,
  running: false,
  task: 0,
  total: TASKS.length,
  step: 'idle',
  paid: 0,
  error: null,
};
let runs = 0;

const pause = (ms = STEP_MS) => new Promise((r) => setTimeout(r, ms));
const clock = async () => {
  const r = await fetch(`${PAYPAL}/__sim/time`, { headers: { Authorization: 'Bearer sim-access-token' } });
  if (!r.ok) throw new Error('Simulated clock unavailable');
  return Number(((await r.json()) as { now: number }).now);
};
const control = async (service: string, path: string, body: unknown = {}) => {
  const r = await fetch(`${service}${path}`, {
    method: 'POST',
    headers: { Authorization: 'Bearer sim-control-key', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status} ${await r.text()}`);
  return r.json() as Promise<Record<string, unknown>>;
};
const yard = async (path: string, method = 'GET', body?: unknown, version = 1, key = 'request') => {
  const raw = body === undefined ? '' : JSON.stringify(body),
    t = String(Math.floor((await clock()) / 1000));
  const signature = createHmac('sha256', 'sim-buyer-secret')
    .update(
      JSON.stringify([
        'yard.request@2',
        t,
        'sim-buyer-key',
        method,
        path,
        key,
        String(version),
        'application/json',
        '',
        raw,
      ]),
    )
    .digest('hex');
  const r = await fetch(`${YARD}${path}`, {
    method,
    ...(raw ? { body: raw } : {}),
    headers: {
      'Yard-Key-Id': 'sim-buyer-key',
      'Yard-Signature': `t=${t},v2=${signature}`,
      'Content-Type': 'application/json',
      'If-Match': String(version),
      'Idempotency-Key': key,
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`Yard ${method} ${path}: HTTP ${r.status} ${await r.text()}`);
  return r.json() as Promise<{ version?: number; state?: string; submission?: { packageId?: string } }>;
};
const stoodWebhook = async (event: Record<string, unknown>) => {
  const raw = JSON.stringify(event),
    t = String(Math.floor((await clock()) / 1000));
  const r = await fetch(`${YARD}/yard/v1/webhooks/stood`, {
    method: 'POST',
    body: raw,
    headers: {
      'Stood-Signature': `t=${t},v1=${createHmac('sha256', 'sim-stood-webhook-secret').update(`${t}.${raw}`).digest('hex')}`,
    },
  });
  if (!r.ok) throw new Error(`Stood webhook ${event.type}: HTTP ${r.status}`);
};
// The simulated clock only moves when asked; the Board's site log allows one write per second per writer.
const advance = async (milliseconds = 1500) => {
  const r = await fetch(`${PAYPAL}/__sim/advance`, {
    method: 'POST',
    headers: { Authorization: 'Bearer sim-access-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ milliseconds }),
  });
  if (!r.ok) throw new Error('Simulated clock did not advance');
};
const tick = async () => {
  await advance();
  await control(CREW, '/__mock/tick');
};
const room = (project: string) => yard(`/yard/v1/blueprints/${project}`);

// Creates and freezes the prewritten blueprint, so the room exists before the click returns.
async function prepare(project: string) {
  const repo = (await (
    await fetch(`${CREW}/__mock/repository`, { headers: { Authorization: 'Bearer sim-control-key' } })
  ).json()) as { repository: string; commit: string };
  const at = await clock();
  const milestones = TASKS.map((t, i) => ({
    id: `t${i + 1}`,
    name: t.name,
    profileId: i === TASKS.length - 1 ? 'code.final@1' : 'code.milestone@1',
    budgetMinor: BUDGET,
    deadline: at + 7 * 86400000,
    testBundleHash: 'b'.repeat(64),
    manifestHash: 'c'.repeat(64),
    testIds: [t.test],
  }));
  await yard(
    '/yard/v1/blueprints',
    'POST',
    {
      id: project,
      buyerOperatorId: 'buyer',
      repository: repo.repository,
      baseCommit: repo.commit,
      summary: 'Demo: a booking app, built task by task',
      capMinor: BUDGET * TASKS.length,
      currency: 'USD',
      milestones,
    },
    1,
    `${project}:create`,
  );
  await yard(
    `/yard/v1/blueprints/${project}/approve`,
    'POST',
    {
      version: 1,
      buyerOperatorId: 'buyer',
      approvalReference: 'sim-approved-terms',
      baselines: milestones.map((m) => ({
        milestoneId: m.id,
        testBundleHash: m.testBundleHash,
        manifestHash: m.manifestHash,
        failedTestIds: m.testIds,
        reference: 'sim-red-baseline',
      })),
    },
    1,
    `${project}:freeze`,
  );
}

async function buildTask(project: string, index: number) {
  const wo = `t${index + 1}`,
    session = `${project}-${wo}`,
    path = `/yard/v1/blueprints/${project}/work-orders/${wo}`;
  const say = (step: string) => {
    status = { ...status, task: index + 1, step };
  };
  say('Stood drafts the payment terms');
  await control(API, `/__mock/sessions/${session}`);
  const draft = (await control(API, `/__mock/sessions/${session}/steps`, { step: 'DRAFT' })) as { trancheId: string };
  const version = Number((await room(project)).version);
  say('Posting the task to the Board');
  await yard(
    `/yard/v1/blueprints/${project}/work-orders`,
    'POST',
    { milestone: wo, trancheId: draft.trancheId },
    version,
    `${session}:post`,
  );
  await pause();
  say('Crew claims the task');
  // Fresh Crew for each task: earlier (paid) jobs are dropped so capacity never runs out.
  await control(CREW, '/__mock/scenario', { name: 'passes-first-time' });
  await control(CREW, '/__mock/poll', { projectId: project, workOrderId: wo });
  await tick();
  await pause();
  say('Stood holds the money on PayPal (sandbox simulator)');
  for (const step of ['AUTHORIZE_FIXTURE', 'DISPATCH'])
    await control(API, `/__mock/sessions/${session}/steps`, { step });
  await stoodWebhook({
    id: `${session}-held`,
    type: 'stood.held',
    projectId: project,
    wo,
    trancheId: draft.trancheId,
    simulated: true,
  });
  await pause();
  say('Crew builds and submits the work');
  for (let i = 0; i < 3; i++) {
    await tick();
    await pause(STEP_MS / 2);
  }
  const submitted = await yard(path);
  const packageId = submitted.submission?.packageId;
  if (!packageId) throw new Error(`Task ${wo} was not submitted (state ${submitted.state})`);
  say('Stood checks the work against the frozen tests');
  await control(API, `/__mock/sessions/${session}/steps`, { step: 'PACKAGE', packageId });
  await control(API, `/__mock/sessions/${session}/steps`, { step: 'ASSESS_FIXTURE' });
  await pause();
  say('Stood releases: capture on PayPal (sandbox simulator)');
  for (const step of ['EXECUTE', 'RECONCILE', 'VERIFY'])
    await control(API, `/__mock/sessions/${session}/steps`, { step });
  const evidence = (await (
    await fetch(`${API}/__mock/sessions/${session}/evidence`, { headers: { Authorization: 'Bearer sim-control-key' } })
  ).json()) as { ledgerReference: string };
  await stoodWebhook({
    id: `${session}-released`,
    type: 'stood.released',
    projectId: project,
    wo,
    trancheId: draft.trancheId,
    packageId,
    reference: evidence.ledgerReference,
    simulated: true,
  });
  status = { ...status, paid: status.paid + 1 };
  await pause();
}

async function run(project: string) {
  try {
    for (let i = 0; i < TASKS.length; i++) await buildTask(project, i);
    status = { ...status, running: false, step: 'All tasks built and paid' };
  } catch (e) {
    console.error('Demo build failed:', e);
    status = { ...status, running: false, error: (e as Error).message, step: 'Stopped' };
  }
}

const app = new Hono();
app.get('/health', (c) => c.json({ status: 'ok', simulated: true }));
app.get('/build', (c) => c.json({ ...status, simulated: true }));
app.post('/build', async (c) => {
  if (status.running) return c.json({ code: 'busy', ...status }, 409);
  const project = `demo-build-${Date.now().toString(36)}-${++runs}`;
  status = {
    projectId: project,
    running: true,
    task: 0,
    total: TASKS.length,
    step: 'Freezing the prewritten plan',
    paid: 0,
    error: null,
  };
  try {
    await prepare(project);
  } catch (e) {
    status = { ...status, running: false, error: (e as Error).message, step: 'Stopped' };
    return c.json({ code: 'prepare_failed', ...status }, 502);
  }
  void run(project);
  return c.json({ ...status, simulated: true }, 202);
});
const server = serve({ fetch: app.fetch, hostname: '0.0.0.0', port: 8082 });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => server.close());
