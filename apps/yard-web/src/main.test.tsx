// @vitest-environment jsdom
import { act, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { api, streams } from '../test/harness.js';

afterEach(() => {
  document.body.innerHTML = '';
  vi.resetModules();
});

// T-0275: the entry point mounts Yard into #root (with Zod in CSP-safe mode) and fails clearly without it.
it('mounts the app into the page root, and refuses to start without one', async () => {
  streams();
  api((c) => (c.path === '/session' ? { body: { mode: 'hosted', role: null } } : { status: 404 }));
  document.body.innerHTML = '<div id="root"></div>';
  await act(async () => {
    await import('./main.js');
  });
  expect(await screen.findByText('LIVE')).toBeTruthy();
  expect(document.querySelector('#root .app')).toBeTruthy();
  vi.resetModules();
  document.body.innerHTML = '';
  await expect(import('./main.js')).rejects.toThrow('Missing application root');
});
