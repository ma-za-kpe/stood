import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { assertScenarioEvidence, scenarioDefinition } from '../scenarios/scenario-contract.js';

const scenario = JSON.parse(readFileSync('services/yard-api/test/scenarios/yard-rework.json', 'utf8')) as {
  id: string;
  expected: { yardState: string; punchList: string[]; attempts: number; captures: number; voids: number };
};
const clock = async () =>
  Number(
    (
      await (
        await fetch('http://paypal-sim:8080/__sim/time', { headers: { Authorization: 'Bearer sim-access-token' } })
      ).json()
    ).now,
  );
const control = async (path: string, value: unknown = {}, service = 'http://api:3000') => {
  const response = await fetch(`${service}${path}`, {
    method: 'POST',
    headers: { Authorization: 'Bearer sim-control-key', 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
    signal: AbortSignal.timeout(10000),
  });
  expect(response.ok, `${path}: ${response.status}`).toBe(true);
  return response.json();
};
const read = async (path: string, service = 'http://api:3000') =>
  (
    await fetch(`${service}${path}`, {
      headers: { Authorization: 'Bearer sim-control-key' },
      signal: AbortSignal.timeout(10000),
    })
  ).json();
const yard = async (path: string, method = 'GET', value?: unknown, version = 1, key = 'request') => {
  const raw = value === undefined ? '' : JSON.stringify(value),
    t = String(Math.floor((await clock()) / 1000));
  return fetch(`http://yard-api:3001${path}`, {
    method,
    ...(raw ? { body: raw } : {}),
    headers: {
      'Yard-Key-Id': 'sim-buyer-key',
      'Yard-Signature': `t=${t},v2=${createHmac('sha256', 'sim-buyer-secret')
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
        .digest('hex')}`,
      'Content-Type': 'application/json',
      'If-Match': String(version),
      'Idempotency-Key': key,
    },
    signal: AbortSignal.timeout(10000),
  });
};
// The site log admits one line per builder per second, so each Crew log step gets its own simulated second.
const advance = async (milliseconds = 1000) => {
  const response = await fetch('http://paypal-sim:8080/__sim/advance', {
    method: 'POST',
    headers: { Authorization: 'Bearer sim-access-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ milliseconds }),
  });
  expect(response.ok).toBe(true);
};
const webhook = async (event: Record<string, unknown>) => {
  const raw = JSON.stringify(event),
    t = String(Math.floor((await clock()) / 1000));
  return fetch('http://yard-api:3001/yard/v1/webhooks/stood', {
    method: 'POST',
    body: raw,
    headers: {
      'Stood-Signature': `t=${t},v1=${createHmac('sha256', 'sim-stood-webhook-secret').update(`${t}.${raw}`).digest('hex')}`,
    },
  });
};

// Network-only runner coordinates synthetic setup. Yard never imports Stood internals; Crew is an ordinary builder.
it('Yard network: refused check → punch list → same Crew reworks → fresh hold → paid projection (T-0233)', async () => {
  const stood = (step: string, extra: Record<string, unknown> = {}) =>
    control(`/__mock/sessions/${scenario.id}/steps`, { step, ...extra });
  const tick = () => control('/__mock/tick', {}, 'http://crew:8081');
  await control('/__mock/scenario', { name: 'fails-then-fixes' }, 'http://crew:8081');
  try {
    await reworkFlow(stood, tick);
  } finally {
    await advance();
    // Later network scenarios and the retained demo expect the default first-time Crew.
    await control('/__mock/scenario', { name: 'passes-first-time' }, 'http://crew:8081');
  }
});
async function reworkFlow(
  stood: (step: string, extra?: Record<string, unknown>) => Promise<Record<string, string>>,
  tick: () => Promise<unknown>,
) {
  await control(`/__mock/sessions/${scenario.id}`);
  const draft = await stood('DRAFT');
  const repo = (await read('/__mock/repository', 'http://crew:8081')) as { repository: string; commit: string };
  const at = await clock();
  const milestones = [
    { id: 'one', name: 'Build the booking app', profileId: 'code.milestone@1' },
    { id: 'two', name: 'Buyer uses the app', profileId: 'code.final@1' },
  ].map((m) => ({
    ...m,
    budgetMinor: 1000,
    deadline: at + 7 * 86400000,
    testBundleHash: 'b'.repeat(64),
    manifestHash: 'c'.repeat(64),
    testIds: ['booking-works'],
  }));
  const project = 'yard-rework-project';
  const created = await yard(
    '/yard/v1/blueprints',
    'POST',
    {
      id: project,
      buyerOperatorId: 'buyer',
      repository: repo.repository,
      baseCommit: repo.commit,
      summary: 'A booking app that needs a second attempt',
      capMinor: 2000,
      currency: 'USD',
      milestones,
    },
    1,
    'create',
  );
  expect(created.status).toBe(201);
  const approval = {
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
  };
  expect((await yard(`/yard/v1/blueprints/${project}/approve`, 'POST', approval, 1, 'freeze')).status).toBe(200);
  const post = { milestone: 'one', trancheId: draft.trancheId };
  expect((await yard(`/yard/v1/blueprints/${project}/work-orders`, 'POST', post, 2, 'post')).status).toBe(200);
  await control('/__mock/poll', {}, 'http://crew:8081');
  await tick();
  const path = `/yard/v1/blueprints/${project}/work-orders/one`;
  expect(await (await yard(path)).json()).toMatchObject({ state: 'CLAIMED', attempt: 1, punchList: null });
  // Attempt 1: held, built, submitted, refused because the signed tests were changed.
  for (const step of ['AUTHORIZE_FIXTURE', 'DISPATCH']) await stood(step);
  await advance();
  for (let i = 0; i < 3; i++) await tick();
  const first = await (await yard(path)).json();
  expect(first).toMatchObject({ state: 'CHECKING', attempt: 1, payment: null });
  await stood('PACKAGE', { packageId: first.submission.packageId });
  for (const step of ['ASSESS_FIXTURE', 'EXECUTE', 'RECONCILE']) await stood(step);
  const refusal = await read(`/__mock/proof/${draft.trancheId}`);
  expect(refusal).toMatchObject({ effect: 'VOID', packageId: first.submission.packageId, resubmissionsLeft: 1 });
  const refusedEvent = {
    id: 'yard-rework-refusal',
    type: 'stood.refused',
    projectId: project,
    wo: 'one',
    trancheId: draft.trancheId,
    packageId: first.submission.packageId,
    reference: refusal.reference,
    simulated: true,
  };
  expect((await webhook({ ...refusedEvent, type: 'stood.released' })).status).toBe(422);
  expect((await (await yard(path)).json()).state).toBe('CHECKING');
  expect((await webhook(refusedEvent)).status).toBe(200);
  expect((await webhook(refusedEvent)).status).toBe(200);
  const rework = await (await yard(path)).json();
  expect(rework).toMatchObject({
    state: 'REWORK',
    attempt: 2,
    payment: null,
    submission: null,
    currentClaim: { builderId: 'sim-crew' },
  });
  expect(rework.punchList.map((p: { field: string }) => p.field)).toEqual(scenario.expected.punchList);
  // Attempt 2: Stood places a fresh hold; the same Crew reads the punch list, rebuilds and resubmits.
  for (const step of ['REDISPATCH', 'AUTHORIZE_FIXTURE', 'DISPATCH']) await stood(step);
  for (let i = 0; i < 3; i++) {
    await advance();
    await tick();
  }
  const second = await (await yard(path)).json();
  expect(second).toMatchObject({ state: 'CHECKING', attempt: 2, payment: null });
  expect(second.submission.packageId).not.toBe(first.submission.packageId);
  expect(second.submission.commit).not.toBe(first.submission.commit);
  const log = await (await yard(`${path}/log`)).json();
  expect(log.lines.map((l: { line: { kind: string } }) => l.line.kind)).toContain('punch_list_received');
  await stood('PACKAGE', { packageId: second.submission.packageId });
  for (const step of ['ASSESS_FIXTURE', 'EXECUTE', 'RECONCILE', 'VERIFY']) await stood(step);
  const evidence = await read(`/__mock/sessions/${scenario.id}/evidence`);
  assertScenarioEvidence(
    scenarioDefinition({
      ...JSON.parse(readFileSync('services/api/test/scenarios/stood/refuse-then-pass.json', 'utf8')),
      id: scenario.id,
    }),
    evidence,
  );
  const released = {
    ...refusedEvent,
    id: 'yard-rework-release',
    type: 'stood.released',
    packageId: second.submission.packageId,
    reference: evidence.ledgerReference,
  };
  // The first refusal can never be replayed onto the second package.
  expect((await webhook({ ...refusedEvent, id: 'refusal-replay' })).status).toBe(422);
  expect((await webhook(released)).status).toBe(200);
  const paid = await (await yard(path)).json();
  expect(paid).toMatchObject({
    state: scenario.expected.yardState,
    attempt: scenario.expected.attempts,
    punchList: null,
    payment: { packageId: second.submission.packageId, reference: evidence.providerReference, simulated: true },
  });
  expect(paid.refusals).toHaveLength(scenario.expected.voids);
  expect(evidence.captures).toBe(scenario.expected.captures);
  expect(paid.refusals[0]).toMatchObject({ packageId: first.submission.packageId, attempt: 1, final: false });
}
