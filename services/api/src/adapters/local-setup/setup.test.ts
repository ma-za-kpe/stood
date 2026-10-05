import { mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { hiddenPrompt } from './hidden-prompt.js';
import { persistEnv, readPlatformKeys, setup } from './setup.js';

const values = [
  'fixture_client',
  'fixture_secret',
  'fixture_webhook',
  'fixture_platform',
  'fixture_hmac',
  'fixture_outbound',
];
const keys = {
  PAYPAL_CLIENT_ID: values[0]!,
  PAYPAL_CLIENT_SECRET: values[1]!,
  PAYPAL_WEBHOOK_ID: values[2]!,
  STOOD_API_KEY: values[3]!,
  STOOD_HMAC_SECRET: values[4]!,
  STOOD_WEBHOOK_SECRET: values[5]!,
};
describe('Local key setup', () => {
  it('prompts only provider names, generates distinct secrets once and saves no token', async () => {
    let index = 0;
    const messages: string[] = [];
    const save = vi.fn(async (_keys: unknown) => {});
    const request = vi.fn(
      async (_url: string, _options: RequestInit) =>
        new Response(
          JSON.stringify({ access_token: 'fixture_ephemeral_token', token_type: 'Bearer', expires_in: 60 }),
          { status: 200 },
        ),
    );
    await setup({
      prompt: async (name) => {
        messages.push(name);
        return values[index++] as string;
      },
      print: (message) => messages.push(message),
      save,
      request,
    });
    expect(index).toBe(3);
    const saved = save.mock.calls[0]?.[0] as unknown as typeof keys;
    expect(saved).toMatchObject({
      PAYPAL_CLIENT_ID: keys.PAYPAL_CLIENT_ID,
      PAYPAL_CLIENT_SECRET: keys.PAYPAL_CLIENT_SECRET,
      PAYPAL_WEBHOOK_ID: keys.PAYPAL_WEBHOOK_ID,
    });
    for (const name of ['STOOD_API_KEY', 'STOOD_HMAC_SECRET', 'STOOD_WEBHOOK_SECRET'] as const) {
      expect(saved[name]).toMatch(/^[a-f0-9]{64}$/);
      expect(messages.filter((m) => m.includes(saved[name]))).toHaveLength(1);
    }
    expect(new Set([saved.STOOD_API_KEY, saved.STOOD_HMAC_SECRET, saved.STOOD_WEBHOOK_SECRET]).size).toBe(3);
    expect(request.mock.calls[0]?.[0]).toBe('https://api-m.sandbox.paypal.com/v1/oauth2/token');
    const options = request.mock.calls[0]?.[1];
    expect(options).toMatchObject({ method: 'POST', redirect: 'error', body: 'grant_type=client_credentials' });
    expect(JSON.stringify(messages)).not.toContain('fixture_');
    expect(JSON.stringify(save.mock.calls)).not.toContain('fixture_ephemeral_token');
  });
  it.each([
    new Response('{}', { status: 401 }),
    new Response('{}'),
    new Response('not-json'),
    new Response('{"access_token":""}'),
    new Response('{"access_token":"token","token_type":"invalid","expires_in":60}'),
  ])('rejects invalid OAuth without saving or exposing response', async (response) => {
    let index = 0;
    const save = vi.fn(async (_keys: unknown) => {});
    await expect(
      setup({ prompt: async () => values[index++] as string, print: () => {}, save, request: async () => response }),
    ).rejects.toThrow('Sandbox key validation failed');
    expect(save).not.toHaveBeenCalled();
  });
  it('contains transport errors and rejects unsafe input or live endpoints before calling', async () => {
    const save = vi.fn(async (_keys: unknown) => {});
    const request = vi.fn(async () => {
      throw new Error('Never expose fixture_secret');
    });
    await expect(setup({ prompt: async () => 'fixture_value', print: () => {}, save, request })).rejects.toThrow(
      'Sandbox key validation failed',
    );
    for (const value of ['', 'line\nbreak', 'value$substitution', "value'quote", 'value\\escape'])
      await expect(setup({ prompt: async () => value, print: () => {}, save, request })).rejects.toThrow(
        'Invalid key input',
      );
    request.mockClear();
    await expect(
      setup({ prompt: async () => 'fixture_value', print: () => {}, save, request }, 'https://api-m.paypal.com'),
    ).rejects.toThrow('Sandbox only');
    expect(request).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
  it('writes only a private .env, preserving unrelated config and removing duplicate keys', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'stood_setup_'));
    try {
      await persistEnv(directory, keys);
      expect((await stat(join(directory, '.env'))).mode & 0o777).toBe(0o600);
      await writeFile(
        join(directory, '.env'),
        '# config\nDEMO_MODE=true\nPAYPAL_CLIENT_ID=old\nPAYPAL_CLIENT_ID=duplicate\n',
      );
      await persistEnv(directory, keys);
      const contents = await readFile(join(directory, '.env'), 'utf8');
      expect(contents).toContain('DEMO_MODE=true');
      expect(contents.match(/PAYPAL_CLIENT_ID=/g)).toHaveLength(1);
      expect(contents).not.toContain('duplicate');
      expect(contents).not.toContain('access_token');
      await rm(join(directory, '.env'));
      await writeFile(join(directory, 'target'), 'unchanged');
      await symlink(join(directory, 'target'), join(directory, '.env'));
      await expect(persistEnv(directory, keys)).rejects.toThrow();
      expect(await readFile(join(directory, 'target'), 'utf8')).toBe('unchanged');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('hides typed input and rejects a noninteractive prompt', async () => {
    const input = new PassThrough();
    const output: string[] = [];
    const writer = new Writable({
      write(chunk, _encoding, callback) {
        output.push(String(chunk));
        callback();
      },
    });
    const result = hiddenPrompt('PAYPAL_CLIENT_SECRET', input, writer, true);
    input.write('fixture_hidden_secret\r');
    expect(await result).toBe('fixture_hidden_secret');
    expect(output.join('')).toContain('PAYPAL_CLIENT_SECRET');
    expect(output.join('')).not.toContain('fixture_hidden_secret');
    await expect(hiddenPrompt('KEY', input, writer, false)).rejects.toThrow('interactive terminal');
  });
});

it('preserves existing platform secrets unless rotation is explicitly selected', async () => {
  const existingPlatform = {
    STOOD_API_KEY: 'existing_api',
    STOOD_HMAC_SECRET: 'existing_hmac',
    STOOD_WEBHOOK_SECRET: 'existing_webhook',
  };
  const messages: string[] = [],
    saved: unknown[] = [];
  const io = {
    prompt: async () => 'fixture_value',
    print: (m: string) => messages.push(m),
    save: async (k: unknown) => {
      saved.push(k);
    },
    request: async () => new Response(JSON.stringify({ access_token: 'token', token_type: 'Bearer', expires_in: 60 })),
    existingPlatform,
  };
  await setup(io);
  expect(saved[0]).toMatchObject(existingPlatform);
  expect(messages.join()).not.toContain('existing_api');
  await setup({ ...io, rotatePlatform: true });
  expect(saved[1]).not.toMatchObject(existingPlatform);
});

it('restores only platform secrets and rejects duplicates and linked config', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stood_restore_'));
  try {
    expect(await readPlatformKeys(directory)).toEqual({});
    await persistEnv(directory, keys);
    expect(await readPlatformKeys(directory)).toEqual({
      STOOD_API_KEY: keys.STOOD_API_KEY,
      STOOD_HMAC_SECRET: keys.STOOD_HMAC_SECRET,
      STOOD_WEBHOOK_SECRET: keys.STOOD_WEBHOOK_SECRET,
    });
    await writeFile(join(directory, '.env'), 'STOOD_API_KEY=one\nSTOOD_API_KEY=two\n');
    await expect(readPlatformKeys(directory)).rejects.toThrow('Duplicate platform key');
    await rm(join(directory, '.env'));
    await writeFile(join(directory, 'target'), 'STOOD_API_KEY=one');
    await symlink(join(directory, 'target'), join(directory, '.env'));
    await expect(readPlatformKeys(directory)).rejects.toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
it.each([
  [async () => new Response('{}', { status: 401 }), 'SANDBOX_KEYS_REJECTED'],
  [async () => new Response('{}', { status: 503 }), 'SANDBOX_UNAVAILABLE'],
  [
    async () => {
      throw new Error('fixture_secret must stay private');
    },
    'SANDBOX_UNAVAILABLE',
  ],
  [async () => new Response('not-json'), 'SANDBOX_INVALID_RESPONSE'],
])('classifies provider setup failures without exposing responses or saving', async (request, code) => {
  const save = vi.fn(async (_keys: unknown) => {});
  await expect(setup({ prompt: async () => 'fixture_value', print: () => {}, save, request })).rejects.toMatchObject({
    code,
  });
  expect(save).not.toHaveBeenCalled();
});
