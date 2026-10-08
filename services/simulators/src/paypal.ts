import { Hono } from 'hono';
import type { FaultController } from './faults.js';
import { replayEvents } from './faults.js';
import { deliverSimulatedWebhook } from './webhooks.js';

type ObjectValue = Record<string, unknown>;
type Reply = { status: number; body: unknown };
type Amount = { currency_code: string; value: string };
type Authorization = {
  id: string;
  status: string;
  amount: Amount;
  create_time: string;
  expiration_time: string;
  supplementary_data: { related_ids: { order_id: string } };
};
type Order = {
  id: string;
  status: string;
  customId: string;
  referenceId: string;
  payee: ObjectValue | null;
  amount: Amount;
  authorizations: string[];
  captures: ObjectValue[];
};
const DAY = 86400000;
const object = (x: unknown): ObjectValue => (x && typeof x === 'object' && !Array.isArray(x) ? (x as ObjectValue) : {});
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
function amount(value: unknown): Amount | null {
  const a = object(value);
  if (
    !['USD', 'GBP', 'EUR'].includes(String(a.currency_code)) ||
    typeof a.value !== 'string' ||
    !/^(0|[1-9]\d{0,8})\.\d{2}$/.test(a.value) ||
    BigInt(a.value.replace('.', '')) <= 0n
  )
    return null;
  return { currency_code: a.currency_code as string, value: a.value };
}
export function createPayPalSimulator(config: {
  environment: string;
  clock: () => number;
  faults?: FaultController;
  webhookUrl?: string;
}) {
  if (!['local', 'ci', 'demo'].includes(config.environment)) throw new Error('Simulator is local-only');
  let offset = 0;
  const now = () => {
    const n = config.clock() + offset;
    if (!Number.isSafeInteger(n) || n < 0) throw new Error('Invalid simulator clock');
    return n;
  };
  const app = new Hono();
  const orders = new Map<string, Order>();
  const authorizations = new Map<string, Authorization>();
  const cache = new Map<string, { signature: string; reply: Reply; expiresAt: number | null }>();
  const setups = new Map<string, ObjectValue>();
  const tokens = new Map<string, ObjectValue>();
  const events: ObjectValue[] = [];
  const deliver = async (url: string, indices: readonly number[] = events.map((_, i) => i)) => {
    for (const event of replayEvents(events, indices)) await deliverSimulatedWebhook({ url, clock: now, event });
  };
  let sequence = 0;
  const id = (kind: string) => `SIM-${kind}-${++sequence}`;
  const error = (status: number, issue: string): Reply => ({
    status,
    body: {
      name: status === 404 ? 'RESOURCE_NOT_FOUND' : 'UNPROCESSABLE_ENTITY',
      details: [{ issue }],
      debug_id: id('DEBUG'),
    },
  });
  const response = (reply: Reply) =>
    new Response(reply.status === 204 ? null : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'Content-Type': 'application/json', 'X-Stood-Simulated': 'true' },
    });
  const emit = (eventType: string, resource: unknown) =>
    events.push({
      id: id('EVENT'),
      event_type: eventType,
      create_time: new Date(now()).toISOString(),
      resource: structuredClone(resource),
    });
  const refresh = (auth: Authorization) => {
    if (auth.status === 'CREATED' && now() >= Date.parse(auth.expiration_time)) auth.status = 'EXPIRED';
    return auth;
  };
  const orderBody = (order: Order) => ({
    id: order.id,
    intent: 'AUTHORIZE',
    status: order.status,
    purchase_units: [
      {
        reference_id: order.referenceId,
        custom_id: order.customId,
        ...(order.payee ? { payee: order.payee } : {}),
        amount: order.amount,
        payments: {
          authorizations: order.authorizations.map((a) => refresh(authorizations.get(a) as Authorization)),
          captures: order.captures,
        },
      },
    ],
    links: ['CREATED', 'APPROVED'].includes(order.status)
      ? [{ href: `http://paypal-sim:8080/__sim/approve/${order.id}`, rel: 'approve', method: 'POST' }]
      : [],
  });
  const authorize = (order: Order, expiresAt: number) => {
    const auth: Authorization = {
      id: id('AUTH'),
      status: 'CREATED',
      amount: order.amount,
      create_time: new Date(now()).toISOString(),
      expiration_time: new Date(expiresAt).toISOString(),
      supplementary_data: { related_ids: { order_id: order.id } },
    };
    authorizations.set(auth.id, auth);
    order.authorizations.push(auth.id);
    emit('PAYMENT.AUTHORIZATION.CREATED', auth);
    return auth;
  };
  const approve = (orderId: string) => {
    const o = orders.get(orderId);
    if (o?.status !== 'CREATED') throw new Error('Unknown or already approved simulator order');
    o.status = 'APPROVED';
    emit('CHECKOUT.ORDER.APPROVED', orderBody(o));
  };
  const approveSetup = (setupId: string) => {
    const setup = setups.get(setupId);
    if (setup?.status !== 'CREATED') throw new Error('Unknown simulator setup');
    setup.status = 'APPROVED';
    object(object(setup.payment_source).paypal).payer_id = 'SIM-PAYER';
  };
  app.onError(() => response(error(400, 'INVALID_REQUEST')));
  app.use('*', async (c, next) => {
    const fault =
      (c.req.path !== '/v1/oauth2/token' && c.req.header('authorization') === 'Bearer sim-access-token') ||
      (c.req.path === '/v1/oauth2/token' &&
        c.req.header('authorization') === `Basic ${Buffer.from('sim-client:sim-secret').toString('base64')}`)
        ? config.faults?.take(c.req.method, c.req.path)
        : null;
    if (!fault) return next();
    if (fault.phase === 'after') await next();
    if (fault.kind === 'TIMEOUT') await config.faults?.wait();
    if (fault.kind === 'MALFORMED') {
      const malformed = new Response('{invalid-json', {
        status: 201,
        headers: { 'X-Stood-Simulated': 'true', 'Content-Type': 'application/json' },
      });
      c.res = malformed;
      return malformed;
    }
    const status = fault.kind === 'RATE_LIMIT' ? 429 : fault.kind === 'HTTP_500' ? 500 : 503;
    const result = response({ status, body: { name: 'SIMULATED_FAULT', simulated: true, kind: fault.kind } });
    if (status === 429) result.headers.set('Retry-After', '1');
    c.res = result;
    return result;
  });
  app.all('*', async (c) => {
    const path = c.req.path;
    const method = c.req.method;
    if (path === '/health' && method === 'GET')
      return response({
        status: 200,
        body: { status: 'ok', provider: 'paypal', mode: 'sim', simulated: true, paymentExecuted: false },
      });
    if (path === '/v1/oauth2/token') {
      if (
        method !== 'POST' ||
        c.req.header('authorization') !== `Basic ${Buffer.from('sim-client:sim-secret').toString('base64')}` ||
        (await c.req.text()) !== 'grant_type=client_credentials'
      )
        return response(error(401, 'INVALID_CLIENT'));
      return response({
        status: 200,
        body: { access_token: 'sim-access-token', token_type: 'Bearer', expires_in: 3600, scope: 'simulator-only' },
      });
    }
    if (c.req.header('authorization') !== 'Bearer sim-access-token') return response(error(401, 'INVALID_TOKEN'));
    if (path === '/__sim/time' && method === 'GET')
      return response({ status: 200, body: { simulated: true, now: now() } });
    if (method === 'GET') {
      const oid = /^\/v2\/checkout\/orders\/([^/]+)$/.exec(path)?.[1];
      if (oid) {
        const o = orders.get(oid);
        return response(o ? { status: 200, body: orderBody(o) } : error(404, 'INVALID_RESOURCE_ID'));
      }
      const aid = /^\/v2\/payments\/authorizations\/([^/]+)$/.exec(path)?.[1];
      if (aid) {
        const a = authorizations.get(aid);
        return response(a ? { status: 200, body: refresh(a) } : error(404, 'INVALID_RESOURCE_ID'));
      }
      const sid = /^\/v3\/vault\/setup-tokens\/([^/]+)$/.exec(path)?.[1];
      if (sid)
        return response(setups.has(sid) ? { status: 200, body: setups.get(sid) } : error(404, 'INVALID_RESOURCE_ID'));
      const tid = /^\/v3\/vault\/payment-tokens\/([^/]+)$/.exec(path)?.[1];
      if (tid)
        return response(tokens.has(tid) ? { status: 200, body: tokens.get(tid) } : error(404, 'INVALID_RESOURCE_ID'));
      // Transaction Search shape (captures only) for the reconciliation audit.
      if (path === '/v1/reporting/transactions') {
        // Transaction Search shape: start/end required, at most 31 days, 1-based pages (T-0155, T-0222).
        const from = Date.parse(c.req.query('start_date') ?? ''),
          to = Date.parse(c.req.query('end_date') ?? '');
        const size = Number(c.req.query('page_size') ?? '100'),
          page = Number(c.req.query('page') ?? '1');
        if (
          !Number.isFinite(from) ||
          !Number.isFinite(to) ||
          to < from ||
          to - from > 31 * 86400000 ||
          !Number.isInteger(size) ||
          size < 1 ||
          size > 500 ||
          !Number.isInteger(page) ||
          page < 1
        )
          return response(error(400, 'INVALID_REQUEST'));
        const all = [...orders.values()].flatMap((o) =>
          o.captures.map((cap) => ({
            transaction_info: {
              transaction_id: cap.id,
              invoice_id: cap.invoice_id,
              transaction_amount: cap.amount,
              transaction_status: 'S',
            },
          })),
        );
        return response({
          status: 200,
          body: {
            transaction_details: all.slice((page - 1) * size, page * size),
            page,
            total_items: all.length,
            total_pages: Math.max(1, Math.ceil(all.length / size)),
            simulated: true,
          },
        });
      }
      if (path === '/v1/notifications/webhooks-events')
        return response({ status: 200, body: { events: structuredClone(events) } });
      const cid = /^\/v2\/payments\/captures\/([^/]+)$/.exec(path)?.[1];
      if (cid) {
        const capture = [...orders.values()].flatMap((o) => o.captures).find((c) => c.id === cid);
        return response(capture ? { status: 200, body: capture } : error(404, 'INVALID_RESOURCE_ID'));
      }
      return response(error(404, 'INVALID_RESOURCE_ID'));
    }
    if (method === 'DELETE') {
      const tid = /^\/v3\/vault\/payment-tokens\/([^/]+)$/.exec(path)?.[1];
      return response(tid && tokens.delete(tid) ? { status: 204, body: null } : error(404, 'INVALID_RESOURCE_ID'));
    }
    if (method !== 'POST') return response(error(405, 'METHOD_NOT_ALLOWED'));
    const raw = await c.req.text();
    if (Buffer.byteLength(raw) > 65536) return response(error(413, 'REQUEST_TOO_LARGE'));
    let body: ObjectValue;
    try {
      body = object(raw ? JSON.parse(raw) : {});
    } catch {
      return response(error(400, 'INVALID_REQUEST'));
    }
    // Control paths are local simulator-only, never provider endpoints or production commands.
    if (path === '/__sim/webhooks/deliver') {
      if (!config.webhookUrl || !Array.isArray(body.indices)) return response(error(422, 'WEBHOOK_NOT_CONFIGURED'));
      try {
        await deliver(config.webhookUrl, body.indices);
        return response({ status: 200, body: { simulated: true, delivered: body.indices.length } });
      } catch {
        return response(error(503, 'WEBHOOK_DELIVERY_FAILED'));
      }
    }
    if (path === '/__sim/advance') {
      if (
        !Number.isSafeInteger(body.milliseconds) ||
        Number(body.milliseconds) < 0 ||
        Number(body.milliseconds) > 366 * DAY
      )
        return response(error(400, 'INVALID_CLOCK_ADVANCE'));
      offset += Number(body.milliseconds);
      return response({ status: 200, body: { simulated: true, now: now() } });
    }
    if (path.startsWith('/__sim/approve/')) {
      try {
        approve(path.slice('/__sim/approve/'.length));
        return response({ status: 200, body: { simulated: true } });
      } catch {
        return response(error(422, 'INVALID_RESOURCE_ID'));
      }
    }
    if (path.startsWith('/__sim/setup-approve/')) {
      try {
        approveSetup(path.slice('/__sim/setup-approve/'.length));
        return response({ status: 200, body: { simulated: true } });
      } catch {
        return response(error(422, 'INVALID_RESOURCE_ID'));
      }
    }
    const key = c.req.header('paypal-request-id');
    if (!key || key.length > 108) return response(error(400, 'REQUEST_ID_REQUIRED'));
    const signature = `${method}:${path}:${canonical(body)}`;
    let old = cache.get(key);
    if (old?.expiresAt !== null && old?.expiresAt !== undefined && now() >= old.expiresAt) {
      cache.delete(key);
      old = undefined;
    }
    if (old)
      return response(old.signature === signature ? structuredClone(old.reply) : error(422, 'DUPLICATE_REQUEST_ID'));
    let reply: Reply;
    if (path === '/v2/checkout/orders') {
      const units = Array.isArray(body.purchase_units) ? body.purchase_units : [];
      const unit = object(units[0]);
      const money = amount(unit.amount);
      const payee = unit.payee === undefined ? null : object(unit.payee);
      if (
        body.intent !== 'AUTHORIZE' ||
        units.length !== 1 ||
        !money ||
        typeof unit.custom_id !== 'string' ||
        !unit.custom_id.trim() ||
        (unit.reference_id !== undefined &&
          (typeof unit.reference_id !== 'string' || !unit.reference_id.trim() || unit.reference_id.length > 256)) ||
        (payee !== null && (typeof payee.merchant_id !== 'string' || !payee.merchant_id.trim()))
      )
        reply = error(422, 'INVALID_ORDER');
      else {
        const o: Order = {
          id: id('ORDER'),
          status: 'CREATED',
          customId: unit.custom_id,
          referenceId: typeof unit.reference_id === 'string' ? unit.reference_id : 'default',
          payee: payee ? { merchant_id: payee.merchant_id } : null,
          amount: money,
          authorizations: [],
          captures: [],
        };
        orders.set(o.id, o);
        reply = {
          status: 201,
          body: {
            ...orderBody(o),
            links: [{ href: `http://paypal-sim:8080/__sim/approve/${o.id}`, rel: 'approve', method: 'POST' }],
          },
        };
      }
    } else if (/^\/v2\/checkout\/orders\/[^/]+\/authorize$/.test(path)) {
      const o = orders.get(path.split('/')[4] ?? '');
      if (!o) reply = error(404, 'INVALID_RESOURCE_ID');
      else if (o.status !== 'APPROVED') reply = error(422, 'ORDER_NOT_APPROVED');
      else {
        authorize(o, now() + 29 * DAY);
        o.status = 'COMPLETED';
        reply = { status: 201, body: orderBody(o) };
      }
    } else if (/^\/v2\/payments\/authorizations\/[^/]+\/(capture|void|reauthorize)$/.test(path)) {
      const auth = authorizations.get(path.split('/')[4] ?? '');
      const action = path.split('/')[5];
      if (!auth) reply = error(404, 'INVALID_RESOURCE_ID');
      else if (refresh(auth).status !== 'CREATED')
        reply = error(
          422,
          auth.status === 'EXPIRED'
            ? 'AUTHORIZATION_EXPIRED'
            : auth.status === 'VOIDED'
              ? 'AUTHORIZATION_VOIDED'
              : 'AUTHORIZATION_ALREADY_CAPTURED',
        );
      else if (
        (action === 'capture' || action === 'reauthorize') &&
        (orders.get(auth.supplementary_data.related_ids.order_id)?.captures.length ?? 0) > 0
      )
        reply = error(422, 'AUTHORIZATION_ALREADY_CAPTURED');
      else if (action === 'void') {
        auth.status = 'VOIDED';
        emit('PAYMENT.AUTHORIZATION.VOIDED', auth);
        // Like PayPal: 200 with the authorization when asked for return=representation, otherwise 204.
        reply = /return=representation/.test(c.req.header('Prefer') ?? '')
          ? { status: 200, body: structuredClone(auth) }
          : { status: 204, body: null };
      } else if (
        !(action === 'reauthorize' && body.amount === undefined) &&
        canonical(amount(body.amount)) !== canonical(auth.amount)
      )
        reply = error(422, 'AMOUNT_MISMATCH');
      else if (action === 'capture') {
        if (body.final_capture !== true || typeof body.invoice_id !== 'string' || !body.invoice_id.trim())
          reply = error(422, 'INVALID_CAPTURE');
        else {
          auth.status = 'CAPTURED';
          const capture = {
            id: id('CAPTURE'),
            status: 'COMPLETED',
            amount: auth.amount,
            invoice_id: body.invoice_id,
            supplementary_data: {
              related_ids: { authorization_id: auth.id, order_id: auth.supplementary_data.related_ids.order_id },
            },
          };
          orders.get(auth.supplementary_data.related_ids.order_id)?.captures.push(capture);
          emit('PAYMENT.CAPTURE.COMPLETED', capture);
          reply = { status: 201, body: capture };
        }
      } else if (now() < Date.parse(auth.create_time) + 3 * DAY) reply = error(422, 'AUTHORIZATION_IN_HONOR_PERIOD');
      else {
        const o = orders.get(auth.supplementary_data.related_ids.order_id) as Order;
        reply =
          o.authorizations.length !== 1
            ? error(422, 'AUTHORIZATION_ALREADY_REAUTHORIZED')
            : { status: 201, body: authorize(o, Date.parse(auth.expiration_time)) };
      }
    } else if (path === '/v3/vault/setup-tokens') {
      const customer = object(body.customer);
      if (
        !object(body.payment_source).paypal ||
        (customer.merchant_customer_id !== undefined &&
          (typeof customer.merchant_customer_id !== 'string' ||
            !/^[0-9a-zA-Z\-_.^*$@#]{1,64}$/.test(customer.merchant_customer_id)))
      )
        reply = error(422, 'INVALID_PAYMENT_SOURCE');
      else {
        const sid = id('SETUP');
        const setup = {
          id: sid,
          status: 'CREATED',
          customer: {
            id: id('CUSTOMER'),
            ...(customer.merchant_customer_id !== undefined
              ? { merchant_customer_id: customer.merchant_customer_id }
              : {}),
          },
          payment_source: { paypal: {} },
          links: [{ href: `http://paypal-sim:8080/__sim/setup-approve/${sid}`, rel: 'approve', method: 'POST' }],
        };
        setups.set(sid, setup);
        reply = { status: 201, body: setup };
      }
    } else if (path === '/v3/vault/payment-tokens') {
      const source = object(object(body.payment_source).token);
      const setup = setups.get(String(source.id));
      const customer = object(body.customer),
        approvedCustomer = object(setup?.customer);
      if (
        source.type !== 'SETUP_TOKEN' ||
        setup?.status !== 'APPROVED' ||
        (customer.id !== undefined && customer.id !== approvedCustomer.id) ||
        (customer.merchant_customer_id !== undefined &&
          customer.merchant_customer_id !== approvedCustomer.merchant_customer_id)
      )
        reply = error(422, 'SETUP_TOKEN_NOT_APPROVED');
      else {
        setup.status = 'VAULTED';
        const tid = id('TOKEN');
        const token = {
          id: tid,
          customer: structuredClone(approvedCustomer),
          payment_source: { paypal: { payer_id: object(object(setup.payment_source).paypal).payer_id } },
        };
        tokens.set(tid, token);
        reply = { status: 201, body: token };
      }
    } else reply = error(404, 'INVALID_RESOURCE_ID');
    cache.set(key, {
      signature,
      reply: structuredClone(reply),
      expiresAt: path.startsWith('/v3/vault/') ? now() + 3 * 3600000 : null,
    });
    return response(reply);
  });
  return { app, approve, approveSetup, deliver, events: () => structuredClone(events) };
}
