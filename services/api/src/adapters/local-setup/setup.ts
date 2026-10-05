import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PAYMENT_KEYS, type PaymentKeys } from '../../application/payment-readiness.js';

export const PLATFORM_KEYS = ['STOOD_API_KEY', 'STOOD_HMAC_SECRET', 'STOOD_WEBHOOK_SECRET'] as const;
export class SetupFailure extends Error {
  constructor(readonly code: 'SANDBOX_KEYS_REJECTED' | 'SANDBOX_UNAVAILABLE' | 'SANDBOX_INVALID_RESPONSE') {
    super(`Sandbox key validation failed: ${code}`);
  }
}
type SetupIO = Readonly<{
  existingPlatform?: PaymentKeys;
  rotatePlatform?: boolean;
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
  io.print(
    'Stood platform secrets are generated locally; existing secrets are preserved unless --rotate-platform is selected.',
  );
  const keys: Partial<Record<(typeof PAYMENT_KEYS)[number], string>> = {};
  for (const name of PAYMENT_KEYS.filter((name) => !PLATFORM_KEYS.includes(name as (typeof PLATFORM_KEYS)[number]))) {
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
    if (response.status === 401 || response.status === 403) throw new SetupFailure('SANDBOX_KEYS_REJECTED');
    if (response.status >= 500 || response.status === 429) throw new SetupFailure('SANDBOX_UNAVAILABLE');
    let token: unknown;
    try {
      token = await response.json();
    } catch {
      throw new SetupFailure('SANDBOX_INVALID_RESPONSE');
    }
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
      throw new SetupFailure('SANDBOX_INVALID_RESPONSE');
  } catch (error) {
    if (error instanceof SetupFailure) throw error;
    throw new SetupFailure('SANDBOX_UNAVAILABLE');
  }
  const generated: (typeof PLATFORM_KEYS)[number][] = [];
  for (const name of PLATFORM_KEYS) {
    const existing = io.existingPlatform?.[name];
    if (existing !== undefined && !valid(existing)) throw new Error('Invalid existing platform key');
    keys[name] = existing && !io.rotatePlatform ? existing : randomBytes(32).toString('hex');
    if (keys[name] !== existing) generated.push(name);
  }
  await io.save(keys);
  for (const name of generated) io.print(`${name} (shown once): ${keys[name]}`);
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

export async function readPlatformKeys(directory: string): Promise<PaymentKeys> {
  let file: Awaited<ReturnType<typeof open>>;
  try {
    file = await open(resolve(directory, '.env'), constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return {};
    throw error;
  }
  try {
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1) throw new Error('Expected private regular .env');
    const keys: Partial<Record<(typeof PLATFORM_KEYS)[number], string>> = {};
    for (const line of (await file.readFile('utf8')).split(/\r?\n/)) {
      for (const name of PLATFORM_KEYS) {
        const match = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=\\s*(.*?)\\s*$`).exec(line);
        if (match) {
          if (keys[name] !== undefined) throw new Error('Duplicate platform key');
          const raw = match[1] ?? '';
          const value: unknown = raw.startsWith('"') ? JSON.parse(raw) : raw;
          if (!valid(value)) throw new Error('Invalid existing platform key');
          keys[name] = value;
        }
      }
    }
    return keys;
  } finally {
    await file.close();
  }
}
