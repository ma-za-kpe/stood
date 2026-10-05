import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PAYMENT_KEYS, type PaymentKeys } from '../../application/payment-readiness.js';

type SetupIO = Readonly<{
  prompt(name: string): Promise<string>;
  print(message: string): void;
  save(keys: PaymentKeys): Promise<void>;
  request(url: string, options: RequestInit): Promise<Response>;
}>;
const sandbox = 'https://api-m.sandbox.paypal.com';
function valid(value: unknown): value is string {
  // Keep .env values literal under both Compose and dotenv. Reject shell/env
  // interpolation, quoting and controls rather than silently altering secrets.
  return typeof value === 'string' && /^[A-Za-z0-9_.:/+=-]+$/.test(value);
}
export async function setup(io: SetupIO, baseUrl: string = sandbox): Promise<void> {
  if (baseUrl !== sandbox) throw new Error('Sandbox only');
  io.print('Sandbox app keys: https://developer.paypal.com/dashboard/applications/sandbox');
  io.print('OAuth: https://developer.paypal.com/api/rest/authentication/');
  io.print('Webhook id: https://developer.paypal.com/api/rest/webhooks/');
  io.print('Platform keys: your local platform configuration; hosted issuance and rotation are planned.');
  const keys: Partial<Record<(typeof PAYMENT_KEYS)[number], string>> = {};
  for (const name of PAYMENT_KEYS) {
    const value = await io.prompt(name);
    if (!valid(value)) throw new Error('Invalid key input');
    keys[name] = value;
  }
  try {
    const response = await io.request(`${sandbox}/v1/oauth2/token`, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: `Basic ${Buffer.from(`${keys.PAYPAL_CLIENT_ID}:${keys.PAYPAL_CLIENT_SECRET}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    const token: unknown = await response.json();
    if (
      !response.ok ||
      !token ||
      typeof token !== 'object' ||
      !('access_token' in token) ||
      !valid(token.access_token) ||
      !('token_type' in token) ||
      token.token_type !== 'Bearer' ||
      !('expires_in' in token) ||
      typeof token.expires_in !== 'number' ||
      !Number.isFinite(token.expires_in) ||
      token.expires_in <= 0
    )
      throw new Error('Invalid OAuth response');
  } catch {
    throw new Error('Sandbox key validation failed');
  }
  await io.save(keys);
  io.print('Sandbox credentials checked. Keys saved to .env. Payments remain off until adapter qualification.');
}

export async function persistEnv(directory: string, keys: PaymentKeys): Promise<void> {
  if (PAYMENT_KEYS.some((name) => !valid(keys[name]))) throw new Error('Invalid key input');
  const file = await open(
    resolve(directory, '.env'),
    constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1) throw new Error('Expected private regular .env');
    const previous = await file.readFile('utf8');
    const lines = previous
      .split(/\r?\n/)
      .filter((line) => !PAYMENT_KEYS.some((name) => new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=`).test(line)));
    while (lines.at(-1) === '') lines.pop();
    const next = [...lines, ...PAYMENT_KEYS.map((name) => `${name}=${JSON.stringify(keys[name])}`), ''].join('\n');
    await file.chmod(0o600);
    await file.truncate(0);
    await file.write(next, 0, 'utf8');
    await file.sync();
  } finally {
    await file.close();
  }
}
