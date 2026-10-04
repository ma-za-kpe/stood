import { mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { hiddenPrompt } from './hidden-prompt.js';
import { persistEnv, setup } from './setup.js';

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
  it('prompts all names, validates sandbox OAuth and saves no token or echoed keys', async () => {
    let index = 0;
    const messages: string[] = [];
    const save = vi.fn(async () => {});
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
    expect(save).toHaveBeenCalledWith(keys);
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
    const save = vi.fn(async () => {});
    await expect(
      setup({ prompt: async () => values[index++] as string, print: () => {}, save, request: async () => response }),
    ).rejects.toThrow('Sandbox key validation failed');
    expect(save).not.toHaveBeenCalled();
  });
  it('contains transport errors and rejects unsafe input or live endpoints before calling', async () => {
    const save = vi.fn(async () => {});
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
