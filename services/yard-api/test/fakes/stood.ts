import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { DraftInput, DraftView, PackageInput, PackageView } from '../../../../packages/stood-sdk/src/client.js';

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, n = 200): v is string => typeof v === 'string' && !!v.trim() && v.length <= n;
const hash = (v: string) => createHash('sha256').update(v).digest();
type ScriptedEvent = {
  id: string;
  trancheId: string;
  packageId: string;
  outcome: 'RELEASE' | 'REFUSE' | 'WAIT';
  simulated: true;
  payment: { executed: false };
  effect: 'CAPTURE' | 'VOID' | 'NONE';
};
function draft(value: unknown): DraftInput {
  if (
    !object(value) ||
    Object.keys(value).some((k) => !['payee_ref', 'cap', 'milestones', 'window_days', 'max_resubmits'].includes(k)) ||
    !text(value.payee_ref) ||
    !object(value.cap) ||
    !Array.isArray(value.milestones) ||
    !value.milestones.length ||
    value.milestones.length > 50 ||
    !Number.isInteger(value.window_days) ||
    Number(value.window_days) < 1 ||
    Number(value.window_days) > 28 ||
    !Number.isInteger(value.max_resubmits) ||
    Number(value.max_resubmits) < 0 ||
    Number(value.max_resubmits) > 5
  )
    throw new Error('Invalid draft');
  const cap = value.cap;
  const money = (v: unknown) =>
    object(v) &&
    Object.keys(v).sort().join() === 'currency,minor' &&
    Number.isSafeInteger(v.minor) &&
    Number(v.minor) > 0 &&
    ['USD', 'GBP', 'EUR'].includes(String(v.currency));
  if (
    !money(cap) ||
    !value.milestones.every(
      (m) =>
        object(m) &&
        Object.keys(m).every((k) => ['name', 'amount', 'profile', 'params'].includes(k)) &&
        text(m.name, 100) &&
        money(m.amount) &&
        (m.amount as Record<string, unknown>).currency === cap.currency &&
        ['code.milestone@1', 'code.final@1'].includes(String(m.profile)) &&
        object(m.params ?? {}),
    )
  )
    throw new Error('Invalid draft');
  if (value.milestones.reduce((sum, m) => sum + BigInt(m.amount.minor), 0n) !== BigInt(Number(cap.minor)))
    throw new Error('Invalid total');
  return structuredClone(value) as unknown as DraftInput;
}
function metadata(value: unknown): PackageInput {
  if (
    !object(value) ||
    Object.keys(value).sort().join() !== 'base_commit,commit_sha,report_ref,report_sha256,repository' ||
    !Object.values(value).every((v) => typeof v === 'string' && v.length <= 256) ||
    !/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(String(value.repository)) ||
    !/^[a-f0-9]{40}$/.test(String(value.base_commit)) ||
    !/^[a-f0-9]{40}$/.test(String(value.commit_sha)) ||
    !/^[a-f0-9]{64}$/.test(String(value.report_sha256)) ||
    !/^[A-Za-z0-9][A-Za-z0-9/_-]*\.json$/.test(String(value.report_ref))
  )
    throw new Error('Invalid package');
  return structuredClone(value) as PackageInput;
}
// Test-only server. Fixed synthetic credentials; no payment authority, database or PayPal dependency.
export function fakeStood(config: { clock(): number }) {
  const app = new Hono();
  const drafts = new Map<string, DraftView>();
  const tranches = new Set<string>();
  const packages = new Map<string, PackageView>();
  const outcomes = new Map<string, ScriptedEvent>();
  const requests = new Map<string, { fingerprint: string; status: 201 | 202; result: DraftView | PackageView }>();
  let sequence = 0;
  app.use('*', bodyLimit({ maxSize: 65536 }));
  app.use('*', async (c, next) => {
    c.header('X-Stood-Simulated', 'true');
    if (c.req.path === '/health') return next();
    const now = config.clock();
    const sig = /^t=(\d{1,12}),v1=([a-f0-9]{64})$/.exec(c.req.header('Stood-Signature') ?? '');
    if (
      !Number.isSafeInteger(now) ||
      !sig ||
      Math.abs(now / 1000 - Number(sig[1])) > 300 ||
      !timingSafeEqual(hash(c.req.header('Authorization') ?? ''), hash('Bearer sim-stood-key'))
    )
      return c.json({ code: 'unauthorized' }, 401);
    const raw = await c.req.text();
    const expected = createHmac('sha256', 'sim-stood-secret').update(`${sig[1]}.${raw}`).digest();
    if (!timingSafeEqual(expected, Buffer.from(sig[2] ?? '', 'hex'))) return c.json({ code: 'unauthorized' }, 401);
    return next();
  });
  app.get('/health', (c) => c.json({ mode: 'fake', simulated: true, paymentExecuted: false }));
  app.get('/v1/allowances/:id', (c) => {
    const value = drafts.get(c.req.param('id'));
    return value ? c.json(value) : c.json({ code: 'not_found' }, 404);
  });
  app.get('/v1/tranches/:id/packages/:packageId', (c) => {
    const value = packages.get(c.req.param('packageId'));
    return value?.trancheId === c.req.param('id') ? c.json(value) : c.json({ code: 'not_found' }, 404);
  });
  app.post('/v1/*', async (c) => {
    const path = c.req.path;
    const tid = /^\/v1\/tranches\/([^/]+)\/packages$/.exec(path)?.[1];
    if (path !== '/v1/allowances' && !tid) return c.json({ code: 'not_implemented' }, 503);
    const key = c.req.header('Idempotency-Key') ?? '';
    if (!text(key) || !/^application\/json(?:;|$)/i.test(c.req.header('Content-Type') ?? ''))
      return c.json({ code: 'validation' }, 422);
    const raw = await c.req.text();
    const fingerprint = JSON.stringify([path, raw]);
    const prior = requests.get(key);
    if (prior)
      return prior.fingerprint === fingerprint ? c.json(prior.result, prior.status) : c.json({ code: 'conflict' }, 409);
    try {
      const value: unknown = JSON.parse(raw);
      let result: DraftView | PackageView;
      let status: 201 | 202;
      if (tid) {
        if (!tranches.has(tid)) return c.json({ code: 'not_found' }, 404);
        result = {
          id: `SIM-PKG-${++sequence}`,
          trancheId: tid,
          status: 'QUEUED',
          waitingFor: 'HOLD',
          createdAt: new Date(config.clock()).toISOString(),
          metadata: metadata(value),
        };
        packages.set(result.id, structuredClone(result));
        status = 202;
      } else {
        const input = draft(value);
        const milestones = input.milestones.map((m) => ({ id: `SIM-TRANCHE-${++sequence}`, name: m.name.trim() }));
        for (const m of milestones) tranches.add(m.id);
        result = { id: `SIM-ALLOWANCE-${++sequence}`, status: 'DRAFT', cap: input.cap, tranches: milestones };
        drafts.set(result.id, structuredClone(result));
        status = 201;
      }
      requests.set(key, { fingerprint, status, result: structuredClone(result) });
      return c.json(result, status);
    } catch {
      return c.json({ code: 'validation' }, 422);
    }
  });
  return {
    app,
    outcome(trancheId: string, packageId: string, outcome: 'RELEASE' | 'REFUSE' | 'WAIT') {
      if (packages.get(packageId)?.trancheId !== trancheId || !['RELEASE', 'REFUSE', 'WAIT'].includes(outcome))
        throw new Error('Unknown package');
      const prior = outcomes.get(trancheId);
      if (prior?.packageId === packageId && prior.outcome === outcome) return structuredClone(prior);
      if (prior && prior.outcome !== 'WAIT') throw new Error('Resolved synthetic outcome cannot change');
      const event: ScriptedEvent = {
        id: `SIM-STOOD-EVENT-${++sequence}`,
        trancheId,
        packageId,
        outcome,
        simulated: true as const,
        payment: { executed: false as const },
        effect: outcome === 'RELEASE' ? 'CAPTURE' : outcome === 'REFUSE' ? 'VOID' : 'NONE',
      };
      outcomes.set(trancheId, structuredClone(event));
      return event;
    },
    signed(event: unknown) {
      const body = JSON.stringify(event);
      const t = String(Math.floor(config.clock() / 1000));
      return {
        body,
        signature: `t=${t},v1=${createHmac('sha256', 'sim-stood-webhook-secret').update(`${t}.${body}`).digest('hex')}`,
      };
    },
  };
}
