import { createHmac, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { CrewBoard, CrewLease, CrewOffer } from '../../src/contracts/crew.js';
import type { Repositories } from '../../src/ports/repositories.js';

const MODES = [
  'PASS',
  'FIX_AFTER_PUNCH',
  'TAMPER_TESTS',
  'SKIP_TESTS',
  'ABANDON',
  'DECLINE_PRICE',
  'LEASE_EXPIRY',
  'DOWN',
] as const;
type Plan = Readonly<{ mode: (typeof MODES)[number]; gpuMinutes: number }>;
export function crewScenario(v: unknown): Plan {
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    Object.keys(v).sort().join() !== 'gpuMinutes,mode' ||
    !('mode' in v) ||
    !MODES.includes(v.mode as Plan['mode']) ||
    !('gpuMinutes' in v) ||
    !Number.isInteger(v.gpuMinutes) ||
    Number(v.gpuMinutes) < 0 ||
    Number(v.gpuMinutes) > 60
  )
    throw new Error('Invalid Crew scenario');
  return Object.freeze({ mode: v.mode as Plan['mode'], gpuMinutes: Number(v.gpuMinutes) });
}
type Job = {
  offer: CrewOffer;
  state: 'queued' | 'building' | 'testing' | 'submitted' | 'clocked_out';
  attempt: number;
  gpuMinutes: number;
  at: number;
  seq: number;
  lease?: CrewLease;
  commit?: string;
};

// Scripted ordinary builder, no model/GPU/payment code and no private Board or Stood access.
export function fakeCrew(config: { clock(): number; board: CrewBoard; repositories: Repositories; scenario: Plan }) {
  const jobs = new Map<string, Job>();
  const requests = new Map<string, { fingerprint: string; response: Promise<unknown> }>();
  const app = new Hono();
  const scenario = crewScenario(config.scenario);
  let busy = false;
  let lastAt = -1;
  const now = () => {
    const at = config.clock();
    if (!Number.isSafeInteger(at) || at < 0 || at < lastAt) throw new Error('Invalid Crew clock');
    lastAt = at;
    return at;
  };
  const log = async (job: Job, kind: string, message: string) => {
    if (!job.lease) throw new Error('No Crew lease');
    await config.board.log(job.offer.id, job.lease.id, {
      seq: ++job.seq,
      at: new Date(now()).toISOString(),
      kind,
      message,
      simulated: true,
    });
  };
  const discover = async (ids?: readonly string[]) => {
    if (scenario.mode === 'DOWN') throw new Error('Simulated Crew unavailable');
    const offered = await config.board.discover(ids);
    const accepted: string[] = [];
    const declined: { id: string; reason: 'stack' | 'price_below_cost' | 'capacity' }[] = [];
    for (const offer of offered) {
      if (ids && !ids.includes(offer.id)) continue;
      if (jobs.has(offer.id)) {
        accepted.push(offer.id);
        continue;
      }
      const reason =
        offer.stack !== 'node'
          ? 'stack'
          : scenario.mode === 'DECLINE_PRICE' || offer.priceMinor < 1000
            ? 'price_below_cost'
            : [...jobs.values()].filter((j) => j.state !== 'clocked_out').length >= 2
              ? 'capacity'
              : null;
      if (reason) declined.push({ id: offer.id, reason });
      else {
        jobs.set(offer.id, {
          offer: structuredClone(offer),
          state: 'queued',
          attempt: 1,
          gpuMinutes: 0,
          at: now(),
          seq: 0,
        });
        accepted.push(offer.id);
      }
    }
    return { accepted, declined, simulated: true };
  };
  const cancel = async (job: Job) => {
    if (['submitted', 'testing'].includes(job.state)) return false;
    if (job.state === 'clocked_out') return true;
    if (job.lease) await config.board.clockOut(job.offer.id, job.lease.id);
    job.state = 'clocked_out';
    job.at = now();
    return true;
  };
  const tick = async () => {
    if (busy) throw new Error('Crew tick already running');
    if (scenario.mode === 'DOWN') throw new Error('Simulated Crew unavailable');
    busy = true;
    try {
      for (const job of jobs.values()) {
        job.at = now();
        if (job.state === 'queued') {
          job.lease = await config.board.claim(job.offer.id, {
            builderId: 'sim-crew',
            operatorId: 'sim-crew-operator',
            operatorRootId: 'sim-crew-operator',
          });
          job.state = 'building';
          await log(job, 'plan', 'Simulated build started.');
          continue;
        }
        if (
          job.state === 'submitted' &&
          scenario.mode === 'FIX_AFTER_PUNCH' &&
          job.attempt === 1 &&
          (await config.board.status(job.offer.id)) === 'PUNCH_LIST'
        ) {
          job.state = 'building';
          job.attempt++;
          await log(job, 'punch_list_received', 'Simulated punch list received.');
          continue;
        }
        if (!['building', 'testing'].includes(job.state) || !job.lease) continue;
        if (now() >= job.lease.expiresAt) {
          job.state = 'clocked_out';
          continue;
        } // The Board owns expiry/reposting.
        if (scenario.mode === 'LEASE_EXPIRY') continue;
        if (scenario.mode === 'ABANDON') {
          await cancel(job);
          continue;
        }
        if (job.state === 'building') {
          const files =
            scenario.mode === 'TAMPER_TESTS'
              ? { 'tests/contract.ts': 'tampered' }
              : scenario.mode === 'SKIP_TESTS'
                ? { 'package.json': '{"scripts":{"test":"echo simulated skipped tests"}}' }
                : {
                    'src/app.ts':
                      scenario.mode === 'FIX_AFTER_PUNCH' && job.attempt === 1
                        ? 'simulated broken build'
                        : 'simulated completed build',
                  };
          try {
            const pushed = await config.repositories.push(
              job.lease.token,
              job.offer.repository,
              `wo/${job.offer.id}`,
              job.commit ?? job.offer.baseCommit,
              files,
            );
            job.commit = pushed.commit;
          } catch {
            await log(job, 'note', 'Simulated repository rejected this build.');
            await cancel(job);
            continue;
          }
          job.gpuMinutes += scenario.gpuMinutes;
          await log(job, 'commit', 'Simulated commit submitted for checking.');
          job.state = 'testing';
        }
        if (!job.commit) throw new Error('Missing simulated commit');
        // Retries after an unknown submit outcome reuse the same commit/key, never create another build.
        await config.board.submit(job.offer.id, job.lease.id, job.commit, `sim-crew:${job.offer.id}:${job.attempt}`);
        job.state = 'submitted';
      }
    } finally {
      busy = false;
    }
  };
  app.use('*', bodyLimit({ maxSize: 65536 }));
  app.use('*', async (c, next) => {
    c.header('X-Stood-Simulated', 'true');
    if (scenario.mode === 'DOWN') return c.json({ code: 'simulated_unavailable' }, 503);
    if (['/crew/v1/health', '/crew/v1/.well-known/agent.json'].includes(c.req.path)) return next();
    const sig = /^t=(\d{1,12}),v1=([a-f0-9]{64})$/.exec(c.req.header('Crew-Signature') ?? '');
    const raw = await c.req.text();
    if (
      c.req.header('Crew-Key-Id') !== 'sim-crew-key' ||
      !sig ||
      Math.abs(now() / 1000 - Number(sig[1])) > 300 ||
      !timingSafeEqual(
        createHmac('sha256', 'sim-crew-secret').update(`${sig[1]}.${raw}`).digest(),
        Buffer.from(sig[2] ?? '', 'hex'),
      )
    )
      return c.json({ code: 'unauthorized' }, 401);
    return next();
  });
  app.onError(() => new Response(JSON.stringify({ code: 'simulated_unavailable', simulated: true }), { status: 503 }));
  app.get('/crew/v1/health', (c) =>
    c.json({
      status: 'ok',
      models: ['scripted'],
      capacity: { free_slots: Math.max(0, 2 - jobs.size) },
      version: 'fixture-1',
      simulated: true,
    }),
  );
  app.get('/crew/v1/.well-known/agent.json', (c) =>
    c.json({
      name: 'Simulated Crew',
      skills: ['code'],
      stacks: ['node'],
      price_floor: 1000,
      operator_id: 'sim-crew-operator',
      simulated: true,
    }),
  );
  app.get('/crew/v1/jobs/:id', (c) => {
    const job = jobs.get(c.req.param('id'));
    return job
      ? c.json({
          state: job.state,
          attempt: job.attempt,
          gpu_minutes: job.gpuMinutes,
          gpu_cost_usd: (job.gpuMinutes * 0.02).toFixed(2),
          last_event_at: new Date(job.at).toISOString(),
          simulated: true,
          paymentAuthority: false,
        })
      : c.json({ code: 'not_found' }, 404);
  });
  app.post('/crew/v1/jobs/:id/cancel', async (c) => {
    const key = c.req.header('Idempotency-Key') ?? '';
    if (!key.trim() || key.length > 200 || (await c.req.text()) !== '{}')
      return c.json({ code: 'invalid_cancel' }, 422);
    const job = jobs.get(c.req.param('id'));
    if (!job) return c.json({ code: 'not_found' }, 404);
    return (await cancel(job))
      ? c.json({ state: job.state, simulated: true })
      : c.json({ code: 'submission_unresolved' }, 409);
  });
  app.post('/crew/v1/nudges', async (c) => {
    const key = c.req.header('Idempotency-Key') ?? '';
    const raw = await c.req.text();
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return c.json({ code: 'invalid_nudge' }, 422);
    }
    if (
      !key.trim() ||
      key.length > 200 ||
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      !('board_url' in value) ||
      value.board_url !== 'http://yard-sim/yard/v1' ||
      !('work_order_ids' in value) ||
      !Array.isArray(value.work_order_ids) ||
      value.work_order_ids.length > 50 ||
      value.work_order_ids.some((id) => typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(id))
    )
      return c.json({ code: 'invalid_nudge' }, 422);
    const prior = requests.get(key);
    if (prior)
      return prior.fingerprint === raw
        ? c.json((await prior.response) as object, 202)
        : c.json({ code: 'conflict' }, 409);
    const response = discover(value.work_order_ids);
    requests.set(key, { fingerprint: raw, response });
    try {
      return c.json(await response, 202);
    } catch (error) {
      requests.delete(key);
      throw error;
    }
  });
  return { app, poll: () => discover(), tick };
}
