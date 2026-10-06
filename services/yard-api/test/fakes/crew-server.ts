import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import type { CrewBoard, CrewOffer } from '../../src/contracts/crew.js';
import { crewScenario, fakeCrew } from './crew.js';
import { FakeRepositories } from './github.js';

if (process.env.NETWORK_MOCK !== 'true' || process.env.APP_ENV !== 'ci') throw new Error('Mock Crew refused');
let at = 0;
const clock = async () => {
  const response = await fetch('http://paypal-sim:8080/__sim/time', {
    headers: { Authorization: 'Bearer sim-access-token' },
  });
  assert(response.ok);
  const value = (await response.json()) as { now: number; simulated: boolean };
  assert(value.simulated === true && Number.isSafeInteger(value.now));
  at = value.now;
  return at;
};
await clock();
const github = new FakeRepositories(() => at, [{ id: 'installation', owner: 'buyer' }]);
const repository = await github.create('installation', 'project', { 'tests/contract.ts': 'signed tests' });
type PublicOffer = CrewOffer & { projectId: string; workOrderId: string; version: number };
const offers = new Map<string, PublicOffer>();
const yard = async (path: string, method = 'GET', body?: unknown, key = 'request', version = 1) => {
  const raw = body === undefined ? '' : JSON.stringify(body),
    t = String(Math.floor((await clock()) / 1000));
  const response = await fetch(`http://yard-api:3001${path}`, {
    method,
    ...(raw ? { body: raw } : {}),
    headers: {
      'Yard-Key-Id': 'sim-builder-key',
      'Yard-Signature': `t=${t},v2=${createHmac('sha256', 'sim-builder-secret')
        .update(
          JSON.stringify([
            'yard.request@2',
            t,
            'sim-builder-key',
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
      'Idempotency-Key': key,
      'Content-Type': 'application/json',
      'If-Match': String(version),
    },
    signal: AbortSignal.timeout(5000),
  });
  assert(response.ok, `Board HTTP ${response.status}`);
  return response.json();
};
const path = (id: string) => {
  const offer = offers.get(id);
  assert(offer);
  return `/yard/v1/blueprints/${offer.projectId}/work-orders/${offer.workOrderId}`;
};
const openOffers = async () => {
  const all: PublicOffer[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  do {
    const response = (await yard(`/yard/v1/board${cursor ? `?after=${encodeURIComponent(cursor)}` : ''}`)) as {
      orders: PublicOffer[];
      nextCursor: string | null;
    };
    all.push(...response.orders);
    cursor = response.nextCursor;
    if (cursor) {
      if (seen.has(cursor)) throw new Error('Board cursor repeated');
      seen.add(cursor);
    }
  } while (cursor);
  return all;
};
const board: CrewBoard = {
  discover: async (ids) => {
    const response = await openOffers();
    for (const o of response) offers.set(o.id, { ...o, stack: 'node' });
    return response.map((o) => offers.get(o.id)!).filter((o) => !ids || ids.includes(o.id));
  },
  claim: async (id, builder) => {
    assert.equal(builder.builderId, 'sim-crew');
    assert.equal(builder.operatorRootId, 'sim-crew-operator');
    const offer = offers.get(id);
    assert(offer);
    const boardView = await openOffers();
    const version = boardView.find((o) => o.id === id)?.version;
    assert(version);
    await yard(`${path(id)}/claim`, 'POST', {}, `${id}:claim`, version);
    const view = (await yard(path(id))) as { currentClaim: { id: string; leasedUntil: number } };
    const project = (await yard(`/yard/v1/blueprints/${offer.projectId}`)) as {
      data: { blueprint: { repository: string; baseCommit: string } };
    };
    const scoped = {
      ...offer,
      repository: project.data.blueprint.repository,
      baseCommit: project.data.blueprint.baseCommit,
    };
    offers.set(id, scoped);
    const token = await github.issue('installation', scoped.repository, 'BUILD', `wo/${id}`);
    return {
      id: view.currentClaim.id,
      expiresAt: view.currentClaim.leasedUntil,
      token: token.value,
      repository: scoped.repository,
      baseCommit: scoped.baseCommit,
    };
  },
  log: async (id, lease, _event) => {
    const view = (await yard(path(id))) as { state: string; projectVersion: number; currentClaim: { id: string } };
    assert.equal(view.currentClaim.id, lease);
    // A commit starts (or restarts, after a punch list) the build on the Board.
    if (['CLAIMED', 'REWORK'].includes(view.state) && _event.kind === 'commit')
      // Each (re)build is a new command: a reused key would replay the first build and change nothing.
      await yard(`${path(id)}/build`, 'POST', {}, `${lease}:build:${view.projectVersion}`, view.projectVersion);
    await yard(
      `${path(id)}/log`,
      'POST',
      { lines: [{ kind: _event.kind, message: _event.message, ...(_event.data ? { data: _event.data } : {}) }] },
      `${lease}:log:${_event.seq}`,
    );
  },
  submit: async (id, lease, commit, key) => {
    const view = (await yard(path(id))) as { projectVersion: number; currentClaim: { id: string } };
    assert.equal(view.currentClaim.id, lease);
    await yard(`${path(id)}/submit`, 'POST', { commit }, key, view.projectVersion);
  },
  clockOut: async () => {
    throw new Error('Network demo clock-out not configured');
  },
  status: async (id) => {
    const view = (await yard(path(id))) as { state: string };
    if (view.state === 'REWORK') return 'PUNCH_LIST';
    assert(['CHECKING', 'PAID'].includes(view.state));
    return 'SUBMITTED';
  },
};
const scenarioFile = (name: string) =>
  crewScenario(JSON.parse(readFileSync(`services/yard-api/test/scenarios/crew/${name}.json`, 'utf8')));
let crew = fakeCrew({ clock: () => at, board, repositories: github, scenario: scenarioFile('passes-first-time') });
const app = new Hono();
app.get('/health', (c) => c.json({ status: 'ok', simulated: true, paymentAuthority: false }));
app.use('/__mock/*', async (c, next) => {
  if (c.req.header('Authorization') !== 'Bearer sim-control-key') return c.json({ code: 'unauthorized' }, 401);
  return next();
});
app.get('/__mock/repository/head', async (c) => {
  await clock();
  if (c.req.query('buyer') !== 'buyer' || c.req.query('repository') !== repository.repository)
    return c.json({ code: 'forbidden' }, 403);
  const token = await github.issue('installation', repository.repository, 'READ');
  const head = await github.head(token.value, repository.repository, 'main');
  return c.json({ repository: repository.repository, baseCommit: head, simulated: true });
});
app.get('/__mock/repository', (c) => c.json({ ...repository, simulated: true }));
// Selects the scripted Crew behaviour for the next network scenario. Earlier jobs are dropped.
app.post('/__mock/scenario', async (c) => {
  const body = (await c.req.json()) as { name?: unknown };
  if (typeof body.name !== 'string' || !/^[a-z][a-z-]{0,40}$/.test(body.name)) return c.json({ code: 'invalid' }, 422);
  crew = fakeCrew({ clock: () => at, board, repositories: github, scenario: scenarioFile(body.name) });
  return c.json({ scenario: body.name, simulated: true });
});
app.post('/__mock/poll', async (c) => {
  await clock();
  await crew.poll();
  return c.json({ simulated: true });
});
app.post('/__mock/tick', async (c) => {
  await clock();
  await crew.tick();
  return c.json({ simulated: true });
});
app.all('*', (c) => crew.app.fetch(c.req.raw));
const server = serve({ fetch: app.fetch, hostname: '0.0.0.0', port: 8081 });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => server.close());
