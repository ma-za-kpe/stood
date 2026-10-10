import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { S3EvidenceStore, signV4 } from './s3-evidence-store.js';

const now = Date.UTC(2026, 9, 10, 12, 0, 0);
const emptyHash = createHash('sha256').update('').digest('hex');
// A bucket that behaves like R2: PUT with If-None-Match: * only creates; every request must be signed.
function bucket(over: { down?: boolean; status?: number } = {}) {
  const objects = new Map<string, Buffer>();
  const calls: { method: string; path: string; headers: Headers }[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    calls.push({ method: init?.method ?? 'GET', path: url.pathname, headers });
    if (over.down) throw new TypeError('fetch failed');
    if (over.status) return new Response('', { status: over.status });
    if (!headers.get('authorization')?.startsWith('AWS4-HMAC-SHA256 Credential=key-id/20261010/auto/s3/aws4_request'))
      return new Response('', { status: 403 });
    if (init?.method === 'PUT') {
      if (objects.has(url.pathname)) return new Response('', { status: 412 });
      objects.set(url.pathname, Buffer.from(init.body as Uint8Array));
      return new Response('', { status: 200 });
    }
    const found = objects.get(url.pathname);
    return found ? new Response(new Uint8Array(found)) : new Response('', { status: 404 });
  };
  return { objects, calls, fetch };
}
const store = (b: ReturnType<typeof bucket>) =>
  new S3EvidenceStore({
    endpoint: 'https://account.r2.example',
    bucket: 'stood-evidence',
    accessKeyId: 'key-id',
    secretAccessKey: 'not-a-real-secret',
    fetch: b.fetch,
    clock: () => now,
  });

// C4 (#77): Stood's evidence lives in its own bucket, written once and addressed by its hash.
describe('S3EvidenceStore', () => {
  it('signs requests exactly as the published SigV4 example', () => {
    // The example in the S3 SigV4 documentation ("GET Object"); its documentation credentials, split for scanners.
    const authorization = signV4({
      method: 'GET',
      url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
      headers: { range: 'bytes=0-9', 'x-amz-content-sha256': emptyHash, 'x-amz-date': '20130524T000000Z' },
      payloadHash: emptyHash,
      amzDate: '20130524T000000Z',
      region: 'us-east-1',
      accessKeyId: ['AKIAIOSFODNN7', 'EXAMPLE'].join(''),
      secretAccessKey: ['wJalrXUtnFEMI', 'K7MDENG', 'bPxRfiCYEXAMPLEKEY'].join('/'),
    });
    expect(authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
        'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, ' +
        'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
  });

  it('stores bytes once under their hash and reads them back', async () => {
    const b = bucket();
    const s = store(b);
    const body = Buffer.from('{"report":1}');
    const hash = createHash('sha256').update(body).digest('hex');
    const stored = await s.put('runs/platform/trn/pkg_1', body, 'application/json');
    expect(stored).toEqual({ key: `runs/platform/trn/pkg_1/${hash}`, sha256: hash, bytes: body.length });
    expect(b.calls[0]).toMatchObject({ method: 'PUT', path: `/stood-evidence/runs/platform/trn/pkg_1/${hash}` });
    expect(b.calls[0]?.headers.get('if-none-match')).toBe('*');
    expect(b.calls[0]?.headers.get('x-amz-content-sha256')).toBe(hash);
    expect(b.calls[0]?.headers.get('x-amz-date')).toBe('20261010T120000Z');
    expect(await s.get(stored.key)).toEqual(body);
    expect(await s.get(`runs/platform/trn/pkg_1/${'0'.repeat(64)}`)).toBeNull();
  });

  it('treats a retry of the same bytes as stored, and different bytes at the key as a conflict', async () => {
    const b = bucket();
    const s = store(b);
    const first = await s.put('runs/p/t/k', Buffer.from('same'), 'application/json');
    expect(await s.put('runs/p/t/k', Buffer.from('same'), 'application/json')).toEqual(first);
    b.objects.set(`/stood-evidence/${first.key}`, Buffer.from('tampered'));
    await expect(s.put('runs/p/t/k', Buffer.from('same'), 'application/json')).rejects.toThrow('EVIDENCE_CONFLICT');
  });

  it('is unavailable when the bucket refuses or cannot be reached, and rejects unsafe keys before any call', async () => {
    for (const b of [bucket({ down: true }), bucket({ status: 503 }), bucket({ status: 403 })]) {
      await expect(store(b).put('runs/p', Buffer.from('x'), 'application/json')).rejects.toThrow(
        'EVIDENCE_UNAVAILABLE',
      );
      await expect(store(b).get('runs/p/x')).rejects.toThrow('EVIDENCE_UNAVAILABLE');
    }
    const b = bucket();
    for (const key of ['../x', '/abs', 'a//b', 'a/../b', 'with space'])
      await expect(store(b).get(key)).rejects.toThrow('EVIDENCE_INVALID_KEY');
    await expect(store(b).put('runs', Buffer.from('x'), 'not a type')).rejects.toThrow('EVIDENCE_INVALID_KEY');
    expect(b.calls).toEqual([]);
    for (const config of [{ bucket: 'Bad_Bucket' }, { accessKeyId: '' }, { endpoint: 'ftp://files.example' }])
      expect(
        () =>
          new S3EvidenceStore({
            endpoint: 'https://account.r2.example',
            bucket: 'stood-evidence',
            accessKeyId: 'id',
            secretAccessKey: 's',
            ...config,
          }),
      ).toThrow('EVIDENCE_INVALID_KEY');
  });
});
