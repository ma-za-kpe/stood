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
      'Yard-Signature': `t=${t},v1=${createHmac('sha256', 'sim-builder-secret')
        .update(`${t}.${method}.${path.split('?')[0]}.${raw}`)
        .digest('hex')}`,
      'Idempotency-Key': key,
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
    if (view.state === 'CLAIMED' && _event.kind === 'commit')
      await yard(`${path(id)}/build`, 'POST', {}, `${id}:build`, view.projectVersion);
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
    assert(['CHECKING', 'PAID'].includes(view.state));
    return 'SUBMITTED';
  },
};
const crew = fakeCrew({
  clock: () => at,
  board,
  repositories: github,
  scenario: crewScenario(
    JSON.parse(readFileSync('services/yard-api/test/scenarios/crew/passes-first-time.json', 'utf8')),
  ),
});
const app = new Hono();
app.get('/health', (c) => c.json({ status: 'ok', simulated: true, paymentAuthority: false }));
app.use('/__mock/*', async (c, next) => {
  if (c.req.header('Authorization') !== 'Bearer sim-control-key') return c.json({ code: 'unauthorized' }, 401);
  return next();
});
app.get('/__mock/repository', (c) => c.json({ ...repository, simulated: true }));
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
