import { randomBytes } from 'node:crypto';
import { S3EvidenceStore } from './adapters/evidence/s3-evidence-store.js';

// Operator tool (C4 #77): qualify Stood's evidence bucket with the settings the reconciler uses. Stores a small
// object, reads it back byte for byte, confirms a retry is the same object and a missing key is absent. Prints only
// the outcome and the object key, never a setting.
const env = process.env;
let store: S3EvidenceStore;
try {
  store = new S3EvidenceStore({
    endpoint: env.STOOD_EVIDENCE_S3_ENDPOINT?.trim() ?? '',
    bucket: env.STOOD_EVIDENCE_S3_BUCKET?.trim() ?? '',
    accessKeyId: env.STOOD_EVIDENCE_S3_ACCESS_KEY_ID?.trim() ?? '',
    secretAccessKey: env.STOOD_EVIDENCE_S3_SECRET_ACCESS_KEY?.trim() ?? '',
  });
} catch {
  process.stdout.write('Evidence check: STOOD_EVIDENCE_S3_* settings are missing or invalid. See docs/SETUP.md.\n');
  process.exit(2);
}
const body = Buffer.from(
  JSON.stringify({ check: 'evidence-check', at: new Date().toISOString(), nonce: randomBytes(8).toString('hex') }),
);
const results: [string, boolean][] = [];
try {
  const stored = await store.put('checks/evidence-check', body, 'application/json');
  results.push(['write once by hash', stored.bytes === body.length]);
  results.push(['read back byte for byte', (await store.get(stored.key))?.equals(body) === true]);
  results.push([
    'retry is the same object',
    (await store.put('checks/evidence-check', body, 'application/json')).key === stored.key,
  ]);
  results.push(['missing key is absent', (await store.get(`checks/evidence-check/${'0'.repeat(64)}`)) === null]);
  process.stdout.write(`Evidence check: stored ${stored.key}\n`);
} catch (error) {
  results.push([`bucket reachable (${(error as Error).message})`, false]);
}
for (const [name, ok] of results) process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}\n`);
process.exit(results.every(([, ok]) => ok) ? 0 : 1);
