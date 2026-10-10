import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import { S3EvidenceStore } from './adapters/evidence/s3-evidence-store.js';
import type { RunnerKey } from './adapters/runner/report-signer.js';
import { SignedReportVerifier } from './adapters/runner/signed-report.js';
import { SANDBOX_IMAGE } from './adapters/runner/vercel-sandbox.js';
import type { EvidenceStore } from './ports/evidence-store.js';

type Env = Readonly<Record<string, string | undefined>>;
// The runner's identity, bound into every signed report.
export const RUNNER_ID = 'stood-vercel-sandbox';
// Audit 2026-10-10: this is the SHA-256 of a label (the managed image's tag and the pinned SDK version), not a
// content digest of the image. Vercel's managed images are named by tag, so it says which configuration ran, not
// exactly which bytes. The signed report keeps the field name imageDigest so stored reports still verify; ADR-0026
// records the limit.
export const RUNNER_LABEL = `${SANDBOX_IMAGE} @vercel/sandbox@3.5.0`;
export const RUNNER_LABEL_HASH = createHash('sha256').update(RUNNER_LABEL).digest('hex');

// T-0159 (ADR-0026): two explicit switches on the reconciler. The code runner needs the Vercel settings, its own
// Ed25519 signing key and Stood's evidence bucket (every signed run is stored before it decides); settlement (capture or void after a decision) runs only when SETTLEMENT_EXECUTOR is "on".
// Anything missing is a named note, never a crash or a printed value.
export function runnerSettings(env: Env): Readonly<{
  runner: Readonly<{ key: RunnerKey; verifier: SignedReportVerifier; evidence: EvidenceStore }> | null;
  settle: boolean;
  notes: readonly string[];
}> {
  const notes: string[] = [];
  let runner: { key: RunnerKey; verifier: SignedReportVerifier; evidence: EvidenceStore } | null = null;
  const vercel = ['VERCEL_TOKEN', 'VERCEL_TEAM_ID', 'VERCEL_PROJECT_ID'].every((k) => env[k]?.trim());
  const keyId = env.RUNNER_KEY_ID?.trim() ?? '';
  let privateKey: ReturnType<typeof createPrivateKey> | null = null;
  try {
    const key = createPrivateKey(Buffer.from(env.RUNNER_SIGNING_KEY ?? '', 'base64').toString('utf8'));
    privateKey = key.asymmetricKeyType === 'ed25519' ? key : null;
  } catch {
    privateKey = null;
  }
  let evidence: EvidenceStore | null = null;
  try {
    evidence = new S3EvidenceStore({
      endpoint: env.STOOD_EVIDENCE_S3_ENDPOINT?.trim() ?? '',
      bucket: env.STOOD_EVIDENCE_S3_BUCKET?.trim() ?? '',
      accessKeyId: env.STOOD_EVIDENCE_S3_ACCESS_KEY_ID?.trim() ?? '',
      secretAccessKey: env.STOOD_EVIDENCE_S3_SECRET_ACCESS_KEY?.trim() ?? '',
    });
  } catch {
    evidence = null;
  }
  if (!vercel) notes.push('Code runner off: VERCEL_TOKEN, VERCEL_TEAM_ID and VERCEL_PROJECT_ID are required.');
  else if (!privateKey || !/^[A-Za-z0-9_.-]{1,64}$/.test(keyId))
    notes.push('Code runner off: RUNNER_KEY_ID and RUNNER_SIGNING_KEY (Ed25519) are required.');
  else if (!evidence)
    notes.push(
      'Code runner off: STOOD_EVIDENCE_S3_ENDPOINT, STOOD_EVIDENCE_S3_BUCKET, STOOD_EVIDENCE_S3_ACCESS_KEY_ID and STOOD_EVIDENCE_S3_SECRET_ACCESS_KEY are required.',
    );
  else {
    const now = Date.now();
    runner = {
      evidence,
      key: { id: keyId, privateKey },
      // The worker verifies its own reports exactly as any other: a signing or binding mistake decides nothing.
      verifier: new SignedReportVerifier(
        [
          {
            id: keyId,
            runnerId: RUNNER_ID,
            publicKey: createPublicKey(privateKey),
            notBefore: now - 86_400_000,
            notAfter: now + 366 * 86_400_000,
            revoked: false,
          },
        ],
        Date.now,
      ),
    };
  }
  const settle = env.SETTLEMENT_EXECUTOR === 'on';
  if (!settle) notes.push('Settlement off: SETTLEMENT_EXECUTOR is not "on".');
  return { runner, settle, notes };
}
