import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import type { RunnerKey } from './adapters/runner/report-signer.js';
import { SignedReportVerifier } from './adapters/runner/signed-report.js';

type Env = Readonly<Record<string, string | undefined>>;
// The runner's identity, bound into every signed report: the managed image and the pinned SDK that drives it.
export const RUNNER_ID = 'stood-vercel-sandbox';
export const RUNNER_IMAGE = createHash('sha256').update('vercel/sandbox/node:24 @vercel/sandbox@3.5.0').digest('hex');

// T-0159 (ADR-0026): two explicit switches on the reconciler. The code runner needs the Vercel settings and its own
// Ed25519 signing key; settlement (capture or void after a decision) runs only when SETTLEMENT_EXECUTOR is "on".
// Anything missing is a named note, never a crash or a printed value.
export function runnerSettings(env: Env): Readonly<{
  runner: Readonly<{ key: RunnerKey; verifier: SignedReportVerifier }> | null;
  settle: boolean;
  notes: readonly string[];
}> {
  const notes: string[] = [];
  let runner: { key: RunnerKey; verifier: SignedReportVerifier } | null = null;
  const vercel = ['VERCEL_TOKEN', 'VERCEL_TEAM_ID', 'VERCEL_PROJECT_ID'].every((k) => env[k]?.trim());
  const keyId = env.RUNNER_KEY_ID?.trim() ?? '';
  let privateKey: ReturnType<typeof createPrivateKey> | null = null;
  try {
    const key = createPrivateKey(Buffer.from(env.RUNNER_SIGNING_KEY ?? '', 'base64').toString('utf8'));
    privateKey = key.asymmetricKeyType === 'ed25519' ? key : null;
  } catch {
    privateKey = null;
  }
  if (!vercel) notes.push('Code runner off: VERCEL_TOKEN, VERCEL_TEAM_ID and VERCEL_PROJECT_ID are required.');
  else if (!privateKey || !/^[A-Za-z0-9_.-]{1,64}$/.test(keyId))
    notes.push('Code runner off: RUNNER_KEY_ID and RUNNER_SIGNING_KEY (Ed25519) are required.');
  else {
    const now = Date.now();
    runner = {
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
