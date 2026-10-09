// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { api, render } from '../test/harness.js';
import { KeysPanel } from './KeysPanel.js';

const list = {
  secrets: [
    { name: 'SUPABASE_URL', provider: 'supabase', environment: 'TEST', version: 2, fingerprint: 'f', createdAt: 1 },
    { name: 'STRIPE_KEY', provider: 'stripe', environment: 'DEV', version: 1, fingerprint: 'g', createdAt: 2 },
  ],
  simulated: true,
};

describe('KeysPanel (T-0275)', () => {
  it('asks for keys only after signing', () => {
    const calls = api(() => ({ body: list }));
    render(<KeysPanel projectId="p1" version={3} signed={false} />);
    expect(screen.getByText(/asked for after you sign/)).toBeTruthy();
    expect(calls).toEqual([]);
  });

  it('validates, stores write-only, clears the value, lists and revokes test keys', async () => {
    const calls = api((c) => (c.method === 'GET' ? { body: list } : { body: { ok: true } }));
    render(<KeysPanel projectId="p1" version={3} signed />);
    await screen.findByText('SUPABASE_URL');
    expect(screen.getByText(/stripe · dev · v1/)).toBeTruthy();
    const name = screen.getByLabelText('Name');
    const value = screen.getByLabelText('Value') as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'not a name' } });
    fireEvent.change(value, { target: { value: 'sk_test_123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Store test key' }));
    expect(screen.getByRole('status').textContent).toMatch(/environment-variable name/);
    fireEvent.change(name, { target: { value: 'supabase_anon_key' } });
    fireEvent.change(value, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Store test key' }));
    expect(screen.getByRole('status').textContent).toBe('Paste the test key.');
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'stripe' } });
    fireEvent.click(screen.getByLabelText('Dev'));
    fireEvent.click(screen.getByLabelText('Test'));
    fireEvent.change(value, { target: { value: 'test-value-123' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Store test key' })));
    expect(value.value).toBe('');
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Stored encrypted/));
    const put = calls.find((c) => c.method === 'PUT');
    expect(put).toMatchObject({ path: '/blueprints/p1/secrets/SUPABASE_ANON_KEY' });
    expect(JSON.parse(put?.body ?? '')).toEqual({ provider: 'stripe', environment: 'TEST', value: 'test-value-123' });
    expect(put?.headers.get('If-Match')).toBe('3');
    expect(put?.headers.get('Idempotency-Key')).toMatch(/^secret-/);
    await act(async () => fireEvent.click(screen.getAllByRole('button', { name: 'Revoke' })[0] as HTMLElement));
    await waitFor(() => expect(calls.some((c) => c.path === '/blueprints/p1/secrets/SUPABASE_URL/revoke')).toBe(true));
  });

  it('explains a refused live key and other failures, and shows the store in progress', async () => {
    let reply: (v: { status: number }) => void = () => undefined;
    api((c) => (c.method === 'GET' ? { body: list } : new Promise((r) => (reply = r))));
    render(<KeysPanel projectId="p1" version={3} signed />);
    await screen.findByText('SUPABASE_URL');
    const store = async () => {
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'API_KEY' } });
      fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'v' } });
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Store test key' })));
    };
    await store();
    expect(await screen.findByRole('button', { name: 'Storing…' })).toHaveProperty('disabled', true);
    await act(async () => reply({ status: 422 }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Only test or dev keys/));
    await store();
    await act(async () => reply({ status: 500 }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/could not complete/));
  });
});
