import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { assertScenarioEvidence, scenarioDefinition } from '../scenarios/scenario-contract.js';

const scenario = JSON.parse(readFileSync('services/yard-api/test/scenarios/yard-first.json', 'utf8')) as {
  id: string;
  expected: { yardState: string; captures: number; stoodState: string; simulated: boolean; moneyExecuted: boolean };
};
// Network-only runner coordinates synthetic setup. The Yard runtime never imports Stood internals.
it('Yard network: frozen terms → ordinary Crew → confirmed simulated Stood capture → paid projection', async () => {
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
  await control(`/__mock/sessions/${scenario.id}`);
  const draft = await control(`/__mock/sessions/${scenario.id}/steps`, { step: 'DRAFT' });
  const repo = (await (
    await fetch('http://crew:8081/__mock/repository', { headers: { Authorization: 'Bearer sim-control-key' } })
  ).json()) as { repository: string; commit: string };
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
  expect(
    (
      await yard(
        '/yard/v1/blueprints',
        'POST',
        {
          id: 'yard-project',
          buyerOperatorId: 'buyer',
          repository: repo.repository,
          baseCommit: repo.commit,
          summary: 'A booking app',
          capMinor: 2000,
          currency: 'USD',
          milestones,
        },
        1,
        'create',
      )
    ).status,
  ).toBe(201);
  expect(
    (
      await yard(
        '/yard/v1/blueprints/yard-project/approve',
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
        'freeze',
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await yard(
        '/yard/v1/blueprints/yard-project/work-orders',
        'POST',
        { milestone: 'one', trancheId: draft.trancheId },
        2,
        'post',
      )
    ).status,
  ).toBe(200);
  await control('/__mock/poll', {}, 'http://crew:8081');
  await control('/__mock/tick', {}, 'http://crew:8081');
  const path = '/yard/v1/blueprints/yard-project/work-orders/one';
  expect(await (await yard(path)).json()).toMatchObject({
    state: 'CLAIMED',
    currentClaim: { builderId: 'sim-crew', outsideOperator: true },
    payment: null,
  });
  for (const step of ['AUTHORIZE_FIXTURE', 'DISPATCH'])
    await control(`/__mock/sessions/${scenario.id}/steps`, { step });
  for (let i = 0; i < 3; i++) await control('/__mock/tick', {}, 'http://crew:8081');
  const submitted = await (await yard(path)).json();
  expect(submitted).toMatchObject({ state: 'CHECKING', payment: null });
  expect(submitted.submission.commit).toMatch(/^[a-f0-9]{40}$/);
  await control(`/__mock/sessions/${scenario.id}/steps`, {
    step: 'PACKAGE',
    packageId: submitted.submission.packageId,
  });
  await control(`/__mock/sessions/${scenario.id}/steps`, { step: 'ASSESS_FIXTURE' });
  expect(await (await yard(path)).json()).toMatchObject({ state: 'CHECKING', payment: null });
  for (const step of ['EXECUTE', 'RECONCILE', 'VERIFY'])
    await control(`/__mock/sessions/${scenario.id}/steps`, { step });
  const evidence = await (
    await fetch(`http://api:3000/__mock/sessions/${scenario.id}/evidence`, {
      headers: { Authorization: 'Bearer sim-control-key' },
    })
  ).json();
  const stoodDefinition = scenarioDefinition({
    ...JSON.parse(readFileSync('services/api/test/scenarios/stood/code-good.json', 'utf8')),
    id: scenario.id,
  });
  assertScenarioEvidence(stoodDefinition, evidence);
  const event = {
    id: 'yard-settlement',
    type: 'stood.released',
    projectId: 'yard-project',
    wo: 'one',
    trancheId: draft.trancheId,
    packageId: submitted.submission.packageId,
    reference: evidence.ledgerReference,
    simulated: true,
  };
  const webhook = async (secret: string) => {
    const raw = JSON.stringify(event),
      t = String(Math.floor((await clock()) / 1000));
    return fetch('http://yard-api:3001/yard/v1/webhooks/stood', {
      method: 'POST',
      body: raw,
      headers: { 'Stood-Signature': `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}` },
    });
  };
  expect((await webhook('forged')).status).toBe(401);
  expect((await (await yard(path)).json()).state).toBe('CHECKING');
  expect((await webhook('sim-stood-webhook-secret')).status).toBe(200);
  expect((await webhook('sim-stood-webhook-secret')).status).toBe(200);
  const paid = await (await yard(path)).json();
  expect(paid).toMatchObject({
    state: scenario.expected.yardState,
    payment: { reference: evidence.providerReference, simulated: true },
    simulated: true,
  });
  const response = await yard('/yard/v1/blueprints/yard-project/events');
  const reader = response.body!.getReader();
  let text = '';
  for (let i = 0; i < 12 && !text.includes('event: stood.released'); i++)
    text += new TextDecoder().decode((await reader.read()).value);
  await reader.cancel();
  expect(text).toContain('event: stood.released');
  expect(text).toContain(evidence.ledgerReference);
});
