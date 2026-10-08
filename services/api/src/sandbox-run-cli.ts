import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import { ServerSdkTransport } from './adapters/payments-paypal/sdk.js';
import { runSandboxScenario, runVaultSetup, type SandboxRecording } from './application/sandbox-run.js';

// Operator tool (T-0224, T-0154): real PayPal SANDBOX runs through Stood's own adapter.
//   release | refuse            the buyer approves this hold in a browser, then capture or void
//   vault-setup                 the buyer approves saving PayPal once; the token goes to .env via scripts/dev
//   vault-release | vault-refuse a later hold from the saved token, with no buyer approval
// Recordings keep ids, statuses and amounts only; the saved token is never printed or recorded.
const SANDBOX = 'https://api-m.sandbox.paypal.com';
const SCENARIOS = ['release', 'refuse', 'vault-setup', 'vault-release', 'vault-refuse'] as const;
const scenario = process.argv[2] as (typeof SCENARIOS)[number];
const clientId = process.env.PAYPAL_CLIENT_ID?.trim() ?? '';
const clientSecret = process.env.PAYPAL_CLIENT_SECRET?.trim() ?? '';
const vaultToken = process.env.PAYPAL_SANDBOX_VAULT_TOKEN_ID?.trim() ?? '';
if (!SCENARIOS.includes(scenario) || !clientId || !clientSecret) {
  process.stderr.write(
    `Usage: sandbox-run-cli.js ${SCENARIOS.join('|')}, with PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET set.\n`,
  );
  process.exit(2);
}
if ((scenario === 'vault-release' || scenario === 'vault-refuse') && !vaultToken) {
  process.stderr.write('Run vault-setup first: it saves PAYPAL_SANDBOX_VAULT_TOKEN_ID to .env.\n');
  process.exit(2);
}

async function token(): Promise<string> {
  const response = await fetch(`${SANDBOX}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const body = (await response.json()) as { access_token?: string; debug_id?: string };
  if (!response.ok || !body.access_token) throw new Error(`Sandbox token refused (HTTP ${response.status})`);
  return body.access_token;
}

// The payee is this sandbox app's own business account. PayPal reports its merchant id on any order.
async function payee(): Promise<string> {
  const configured = process.env.STOOD_SANDBOX_PAYEE_ID?.trim();
  if (configured) return configured;
  const response = await fetch(`${SANDBOX}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await token()}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': `stood-payee-probe-${Date.now()}`,
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      intent: 'AUTHORIZE',
      purchase_units: [{ amount: { currency_code: 'USD', value: '1.00' } }],
    }),
  });
  const body = (await response.json()) as { purchase_units?: { payee?: { merchant_id?: string } }[] };
  const id = body.purchase_units?.[0]?.payee?.merchant_id;
  if (!id) throw new Error(`Could not read the sandbox merchant id (HTTP ${response.status})`);
  return id;
}

const runId = `sandbox-${scenario}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
// Saving PayPal needs approval callbacks; any https page on one origin works (the buyer just lands there).
const transport = new ServerSdkTransport({
  appEnv: 'local',
  mode: 'live',
  baseUrl: SANDBOX,
  clientId,
  clientSecret,
  vaultReturnUrl: 'https://ma-za-kpe.github.io/stood/?vault=saved',
  vaultCancelUrl: 'https://ma-za-kpe.github.io/stood/?vault=cancelled',
});
const approve = async (link: string) => {
  process.stdout.write(
    `\nOpen this link and approve as your SANDBOX PERSONAL (buyer) account:\n\n  ${link}\n\nWaiting up to 15 minutes...\n`,
  );
};
const sleep = (ms: number) => setTimeout(ms);
let recording: SandboxRecording;
if (scenario === 'vault-setup') {
  const saved = await runVaultSetup({ mode: 'live', transport, runId, approve, sleep, maxPolls: 180 });
  recording = saved.recording;
  if (saved.tokenId) {
    // Handed to scripts/dev, which moves it into .env and deletes the file.
    mkdirSync('.sandbox', { recursive: true, mode: 0o700 });
    writeFileSync('.sandbox/vault-token', saved.tokenId, { mode: 0o600 });
  }
} else {
  recording = await runSandboxScenario({
    scenario: scenario.endsWith('release') ? 'release' : 'refuse',
    mode: 'live',
    transport,
    payeeRef: await payee(),
    runId,
    ...(scenario.startsWith('vault-') ? { vaultId: vaultToken } : {}),
    approve,
    sleep,
    maxPolls: 180,
  });
}
const dir = 'services/api/test/scenarios/sandbox';
mkdirSync(dir, { recursive: true });
const file = `${dir}/${runId}.json`;
writeFileSync(file, `${JSON.stringify({ ...recording, recordedAt: new Date().toISOString() }, null, 2)}\n`);
const order = recording.steps[0]?.ids.order;
process.stdout.write(
  `\nOutcome: ${recording.outcome}\nRecorded: ${file}\n${order ? `Second witness: tools/paypal-witness/witness.py order ${order}\n` : ''}`,
);
