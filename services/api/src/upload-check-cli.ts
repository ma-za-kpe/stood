import { createHash, randomUUID } from 'node:crypto';
import { S3EvidenceStore } from './adapters/evidence/s3-evidence-store.js';

// T-0156: qualify the actual bucket's presigned PUT, checksum, size and conditional write contract. This small
// synthetic byte probe qualifies storage only, not a photo decoder, evidence assessment or payment.
const env = process.env;
let phase = 'configuration';
let cleanupKey: string | undefined;
let store: S3EvidenceStore | undefined;
try {
  const storage = new S3EvidenceStore({
    endpoint: env.STOOD_EVIDENCE_S3_ENDPOINT ?? '',
    bucket: env.STOOD_EVIDENCE_S3_BUCKET ?? '',
    accessKeyId: env.STOOD_EVIDENCE_S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: env.STOOD_EVIDENCE_S3_SECRET_ACCESS_KEY ?? '',
  });
  store = storage;
  const body = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xfe]),
    Buffer.from(randomUUID()),
    Buffer.from([0xff, 0xd9]),
  ]);
  const sha256 = createHash('sha256').update(body).digest('hex');
  const photo = {
    key: `uploads/upl_${randomUUID()}/0-${sha256}`,
    sha256,
    bytes: body.length,
    contentType: 'image/jpeg' as const,
  };
  const put = storage.presignPut(photo, Date.now() + 60_000);
  const request = (headers: Record<string, string>, bytes = body) =>
    fetch(put.url, { method: 'PUT', headers, body: new Uint8Array(bytes), signal: AbortSignal.timeout(30_000) });
  phase = 'synthetic PUT';
  const first = await request({ ...put.headers });
  if (!first.ok) throw new Error('presigned PUT refused');
  cleanupKey = photo.key;
  phase = 'bounded read-back';
  const read = await storage.get(photo.key, photo.bytes);
  if (!read?.equals(body)) throw new Error('stored bytes differ');
  phase = 'write-once check';
  const retry = await request({ ...put.headers });
  if (retry.status !== 412) throw new Error('object overwrite was not refused');
  phase = 'content-type binding check';
  const changedType = await request({ ...put.headers, 'content-type': 'image/webp' });
  if (changedType.status !== 403) throw new Error('content type signature not enforced');
  phase = 'synthetic object deletion';
  if ((await storage.deleteUpload(photo.key)) !== 'DELETED') throw new Error('synthetic upload was not removed');
  if (await storage.get(photo.key, photo.bytes)) throw new Error('deleted synthetic object is still readable');
  cleanupKey = undefined;
  phase = 'deletion retry check';
  await storage.deleteUpload(photo.key);
  process.stdout.write(
    'PASS presigned PUT; exact bounded read; overwrite refused; changed content type refused; exact upload removal is idempotent\n',
  );
} catch {
  if (cleanupKey) {
    try {
      if (!store) throw new Error('Storage is unavailable');
      await store.deleteUpload(cleanupKey);
    } catch {
      process.stderr.write(`Synthetic test object may need cleanup: ${cleanupKey}\n`);
    }
  }
  process.stdout.write(`FAIL upload storage qualification at ${phase}; no URL or private provider response printed\n`);
  process.exitCode = 1;
}
