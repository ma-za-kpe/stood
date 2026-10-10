/**
 * Stood platform SDK: request signing (hand-written, saved as an APIMatic customization so it survives
 * regeneration). Not generated.
 *
 * Every Stood request carries the platform key and a Stood-Signature computed over the request itself:
 *   t=<unix seconds>,v2=<hex HMAC-SHA256(secret, JSON ["stood.request@2", t, METHOD, path+query,
 *   Idempotency-Key, If-Match, Content-Type, body])>
 * An OpenAPI security scheme cannot express a per-request HMAC, so the generated client sends a fixed header.
 * createStoodClient swaps in an HTTP adapter that signs each request just before it is sent.
 */
import { createHmac } from 'crypto';
import { Client } from './client.js';
import { Environment } from './configuration.js';

export type StoodClientOptions = {
  platformKey: string;
  signingSecret: string;
  /** Defaults to https://stood-api.onrender.com/v1 (PayPal sandbox only). */
  baseUrl?: string;
  timeout?: number;
  /** Milliseconds since the epoch; for tests. */
  clock?: () => number;
};

const PRODUCTION = 'https://stood-api.onrender.com/v1';

export function stoodSignature(
  secret: string,
  unixSeconds: number,
  request: {
    method: string;
    pathAndQuery: string;
    idempotencyKey?: string;
    ifMatch?: string;
    contentType?: string;
    body?: string;
  }
): string {
  const t = String(unixSeconds);
  const mac = createHmac('sha256', secret)
    .update(
      JSON.stringify([
        'stood.request@2',
        t,
        request.method.toUpperCase(),
        request.pathAndQuery,
        request.idempotencyKey ?? '',
        request.ifMatch ?? '',
        request.contentType ?? '',
        request.body ?? '',
      ])
    )
    .digest('hex');
  return `t=${t},v2=${mac}`;
}

function plainHeaders(headers: any): Record<string, string> {
  const raw = headers && typeof headers.toJSON === 'function' ? headers.toJSON() : headers ?? {};
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (value !== undefined && value !== null && typeof value !== 'object') out[name] = String(value);
  }
  return out;
}
const header = (headers: Record<string, string>, name: string) =>
  Object.entries(headers).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];

/** An axios-compatible adapter that signs, sends with fetch and returns the raw text body. */
export function signingAdapter(options: StoodClientOptions) {
  const base = new URL(options.baseUrl ?? PRODUCTION);
  const clock = options.clock ?? Date.now;
  return async (config: any) => {
    const generated = new URL(config.url, config.baseURL);
    // Requests are generated against the production base; keep their path below /v1 and send them to `base`.
    const relative = generated.pathname.replace(/^\/v1/, '');
    const url = new URL(`${base.pathname.replace(/\/$/, '')}${relative}${generated.search}`, base);
    const method = String(config.method ?? 'get').toUpperCase();
    const body = config.data === undefined || config.data === null ? '' : typeof config.data === 'string' ? config.data : JSON.stringify(config.data);
    const headers = plainHeaders(config.headers);
    for (const name of Object.keys(headers)) if (name.toLowerCase() === 'stood-signature') delete headers[name];
    headers['Stood-Signature'] = stoodSignature(options.signingSecret, Math.floor(clock() / 1000), {
      method,
      // The server signs the path as seen from its /v1 mount.
      pathAndQuery: `/v1${relative}${generated.search}`,
      idempotencyKey: header(headers, 'Idempotency-Key'),
      ifMatch: header(headers, 'If-Match'),
      contentType: header(headers, 'Content-Type'),
      body,
    });
    const response = await fetch(url, {
      method,
      headers,
      body: body && method !== 'GET' && method !== 'HEAD' ? body : undefined,
      signal: AbortSignal.timeout(options.timeout ?? 30_000),
    });
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, name) => {
      responseHeaders[name] = value;
    });
    return {
      data: await response.text(),
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      config,
      request: {},
    };
  };
}

/** A generated Stood client whose every request is signed. */
export function createStoodClient(options: StoodClientOptions): Client {
  return new Client({
    environment: Environment.Production,
    timeout: options.timeout ?? 30_000,
    platformKeyCredentials: { accessToken: options.platformKey },
    // Replaced on every request by signingAdapter.
    requestSignatureCredentials: { 'Stood-Signature': 'signed-per-request' },
    unstable_httpClientOptions: { adapter: signingAdapter(options) },
  });
}
