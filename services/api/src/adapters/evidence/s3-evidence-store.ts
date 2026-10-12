import { createHash, createHmac } from 'node:crypto';
import { type EvidenceStore, EvidenceStoreError, type StoredEvidence } from '../../ports/evidence-store.js';
import type { StoredUploadPhoto } from '../../ports/upload-store.js';

type Config = Readonly<{
  // S3-compatible endpoint, e.g. Cloudflare R2's https://<account>.r2.cloudflarestorage.com. Path-style requests.
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  // R2 accepts "auto"; other S3-compatible stores name their own region.
  region?: string;
  fetch?: typeof globalThis.fetch;
  clock?: () => number;
}>;
const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string) => createHmac('sha256', key).update(data).digest();
const KEY = /^[a-z0-9][a-z0-9._-]{0,99}(?:\/[a-z0-9][a-z0-9._-]{0,99}){0,7}$/i;
const BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

// AWS Signature Version 4, the request signing every S3-compatible store accepts (R2 included). Signs the host and
// every header given; exported so it can be checked against the published example.
export function signV4(
  request: Readonly<{
    method: string;
    url: URL;
    headers: Readonly<Record<string, string>>;
    payloadHash: string;
    amzDate: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
  }>,
): string {
  const headers = Object.entries({ ...request.headers, host: request.url.host })
    .map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, ' ')] as const)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  const signed = headers.map(([k]) => k).join(';');
  const canonical = [
    request.method,
    request.url.pathname,
    request.url.search.slice(1),
    ...headers.map(([k, v]) => `${k}:${v}`),
    '',
    signed,
    request.payloadHash,
  ].join('\n');
  const day = request.amzDate.slice(0, 8);
  const scope = `${day}/${request.region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', request.amzDate, scope, sha256(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${request.secretAccessKey}`, day), request.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  return `AWS4-HMAC-SHA256 Credential=${request.accessKeyId}/${scope}, SignedHeaders=${signed}, Signature=${signature}`;
}

// C4 (#77): evidence in Stood's own S3-compatible bucket (Cloudflare R2 in the demo; SeaweedFS locally). Write-once:
// the key ends in the body's SHA-256, and a PUT only creates (If-None-Match: *). Anything it cannot do safely is
// UNAVAILABLE, so the caller waits; nothing is ever treated as stored when it is not.
export class S3EvidenceStore implements EvidenceStore {
  private readonly http: typeof globalThis.fetch;
  private readonly clock: () => number;
  private readonly base: URL;
  constructor(private readonly config: Config) {
    if (!BUCKET.test(config.bucket) || !config.accessKeyId || !config.secretAccessKey)
      throw new EvidenceStoreError('INVALID_KEY');
    this.base = new URL(config.endpoint);
    if (this.base.protocol !== 'https:' && this.base.protocol !== 'http:') throw new EvidenceStoreError('INVALID_KEY');
    this.http = config.fetch ?? fetch;
    this.clock = config.clock ?? Date.now;
  }
  private async send(method: 'GET' | 'PUT', key: string, body?: Buffer, extra: Record<string, string> = {}) {
    const url = new URL(`/${this.config.bucket}/${key}`, this.base);
    const payloadHash = sha256(body ?? '');
    const amzDate = new Date(this.clock()).toISOString().replace(/[-:]|\.\d{3}/g, '');
    const headers = { ...extra, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
    const authorization = signV4({
      method,
      url,
      headers,
      payloadHash,
      amzDate,
      region: this.config.region ?? 'auto',
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
    });
    try {
      return await this.http(url, {
        method,
        headers: { ...headers, authorization },
        ...(body ? { body: new Uint8Array(body) } : {}),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new EvidenceStoreError('UNAVAILABLE');
    }
  }

  async put(prefix: string, body: Buffer, contentType: string): Promise<StoredEvidence> {
    const hash = sha256(body);
    const key = `${prefix}/${hash}`;
    if (!KEY.test(key) || !/^[\w.+-]+\/[\w.+-]+$/.test(contentType)) throw new EvidenceStoreError('INVALID_KEY');
    const response = await this.send('PUT', key, body, { 'content-type': contentType, 'if-none-match': '*' });
    // 412: something is already at this key. It is ours only if it holds exactly these bytes.
    if (response.status === 412) {
      const existing = await this.get(key);
      if (!existing || sha256(existing) !== hash) throw new EvidenceStoreError('CONFLICT');
    } else if (!response.ok) throw new EvidenceStoreError('UNAVAILABLE');
    return { key, sha256: hash, bytes: body.length };
  }

  presignPut(photo: StoredUploadPhoto, expiresAt: number) {
    const now = this.clock(),
      expires = Math.floor((expiresAt - now) / 1000);
    if (
      !KEY.test(photo.key) ||
      !/^[a-f0-9]{64}$/.test(photo.sha256) ||
      !['image/jpeg', 'image/heic', 'image/webp'].includes(photo.contentType) ||
      !Number.isSafeInteger(photo.bytes) ||
      photo.bytes < 1 ||
      photo.bytes > 8 * 1024 * 1024 ||
      !Number.isSafeInteger(expiresAt) ||
      expires < 1 ||
      expiresAt - now > 900000
    )
      throw new EvidenceStoreError('INVALID_KEY');
    const url = new URL(`/${this.config.bucket}/${photo.key}`, this.base);
    const headers = {
      'content-length': String(photo.bytes),
      'content-type': photo.contentType,
      'if-none-match': '*',
      'x-amz-checksum-sha256': Buffer.from(photo.sha256, 'hex').toString('base64'),
    };
    const amzDate = new Date(now).toISOString().replace(/[-:]|\.\d{3}/g, ''),
      day = amzDate.slice(0, 8);
    const scope = `${day}/${this.config.region ?? 'auto'}/s3/aws4_request`;
    const signedHeaders = Object.entries({ ...headers, host: url.host }).sort(([a], [b]) => (a < b ? -1 : 1));
    const encode = (v: string) =>
      encodeURIComponent(v).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
    const params = {
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': `${this.config.accessKeyId}/${scope}`,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': String(expires),
      'X-Amz-SignedHeaders': signedHeaders.map(([k]) => k).join(';'),
    };
    const query = Object.entries(params)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${encode(k)}=${encode(v)}`)
      .join('&');
    const canonical = [
      'PUT',
      url.pathname,
      query,
      ...signedHeaders.map(([k, v]) => `${k}:${v}`),
      '',
      params['X-Amz-SignedHeaders'],
      'UNSIGNED-PAYLOAD',
    ].join('\n');
    const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
    const signingKey = hmac(
      hmac(hmac(hmac(`AWS4${this.config.secretAccessKey}`, day), this.config.region ?? 'auto'), 's3'),
      'aws4_request',
    );
    url.search = `${query}&X-Amz-Signature=${createHmac('sha256', signingKey).update(toSign).digest('hex')}`;
    return { url: url.toString(), headers };
  }

  async get(key: string, maxBytes?: number): Promise<Buffer | null> {
    if (!KEY.test(key) || (maxBytes !== undefined && (!Number.isSafeInteger(maxBytes) || maxBytes < 1)))
      throw new EvidenceStoreError('INVALID_KEY');
    const response = await this.send('GET', key);
    if (response.status === 404) return null;
    if (!response.ok) throw new EvidenceStoreError('UNAVAILABLE');
    if (maxBytes === undefined) return Buffer.from(await response.arrayBuffer());
    if (Number(response.headers.get('content-length')) > maxBytes) {
      await response.body?.cancel();
      throw new EvidenceStoreError('CONFLICT');
    }
    if (!response.body) throw new EvidenceStoreError('UNAVAILABLE');
    const reader = response.body.getReader(),
      chunks: Buffer[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) return Buffer.concat(chunks, bytes);
        bytes += part.value.byteLength;
        if (bytes > maxBytes) {
          await reader.cancel();
          throw new EvidenceStoreError('CONFLICT');
        }
        chunks.push(Buffer.from(part.value));
      }
    } catch (error) {
      if (error instanceof EvidenceStoreError) throw error;
      throw new EvidenceStoreError('UNAVAILABLE');
    } finally {
      reader.releaseLock();
    }
  }
}
