import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import { ServerSdkTransport } from './adapters/payments-paypal/sdk.js';
import { runSandboxScenario } from './application/sandbox-run.js';

// Operator tool (T-0224): one real PayPal SANDBOX run through Stood's own adapter. The buyer approves in a
// browser; the run then holds, releases (capture) or refuses (void), and records ids, statuses and amounts.
const SANDBOX = 'https://api-m.sandbox.paypal.com';
const scenario = process.argv[2];
const clientId = process.env.PAYPAL_CLIENT_ID?.trim() ?? '';
const clientSecret = process.env.PAYPAL_CLIENT_SECRET?.trim() ?? '';
if ((scenario !== 'release' && scenario !== 'refuse') || !clientId || !clientSecret) {
  process.stderr.write(
    'Usage: sandbox-run-cli.js release|refuse, with PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET set.\n',
  );
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
const transport = new ServerSdkTransport({ appEnv: 'local', mode: 'live', baseUrl: SANDBOX, clientId, clientSecret });
const recording = await runSandboxScenario({
  scenario,
  mode: 'live',
  transport,
  payeeRef: await payee(),
  runId,
  approve: async (link) => {
    process.stdout.write(
      `\nOpen this link and approve as your SANDBOX PERSONAL (buyer) account:\n\n  ${link}\n\nWaiting up to 15 minutes...\n`,
    );
  },
  sleep: (ms) => setTimeout(ms),
  maxPolls: 180,
});
const dir = 'services/api/test/scenarios/sandbox';
mkdirSync(dir, { recursive: true });
const file = `${dir}/${runId}.json`;
writeFileSync(file, `${JSON.stringify({ ...recording, recordedAt: new Date().toISOString() }, null, 2)}\n`);
const order = recording.steps[0]?.ids.order ?? 'ORDER_ID';
process.stdout.write(
  `\nOutcome: ${recording.outcome}\nRecorded: ${file}\nSecond witness: tools/paypal-witness/witness.py order ${order}\n`,
);
