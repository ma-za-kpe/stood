import { createHmac } from 'node:crypto';
import type { Hono } from 'hono';
import type { YardCall } from '../application/demo-autopilot.js';

type Signer = Readonly<{ key: string; secret: string }>;

// The demo autopilot acts as two ordinary operators (the signed-in buyer and the Crew builder) through Yard's own
// signed routes, in-process. It never bypasses a route's checks: each call is signed exactly as a client would sign.
export function signedYardCall(
  app: () => Hono | null,
  as: Readonly<{ buyer: Signer; crew: Signer }>,
  clock: () => number,
): YardCall {
  return async (who, method, path, body, version, key) => {
    const target = app();
    if (!target) throw new Error('Yard app not ready');
    const operator = who === 'buyer' ? as.buyer : as.crew;
    const raw = body === undefined ? '' : JSON.stringify(body);
    const url = `/yard/v1${path}`;
    const headers = new Headers({ 'Yard-Key-Id': operator.key, 'Content-Type': 'application/json' });
    if (version !== undefined) headers.set('If-Match', String(version));
    if (key) headers.set('Idempotency-Key', key);
    const t = String(Math.floor(clock() / 1000));
    headers.set(
      'Yard-Signature',
      `t=${t},v2=${createHmac('sha256', operator.secret)
        .update(
          JSON.stringify([
            'yard.request@2',
            t,
            operator.key,
            method,
            url,
            headers.get('Idempotency-Key') ?? '',
            headers.get('If-Match') ?? '',
            headers.get('Content-Type') ?? '',
            '',
            raw,
          ]),
        )
        .digest('hex')}`,
    );
    const response = await target.fetch(
      new Request(`http://yard.internal${url}`, { method, headers, ...(raw ? { body: raw } : {}) }),
    );
    const value = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) throw new Error(`Yard ${method} ${path}: HTTP ${response.status} ${String(value.code ?? '')}`);
    return value;
  };
}
