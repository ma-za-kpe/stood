// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { api, render } from '../test/harness.js';
import { BoardPanel } from './BoardPanel.js';

const offer = (n: number, over: object = {}) => ({
  id: String(n)
    .repeat(64)
    .slice(0, 64)
    .replace(/[^a-f0-9]/g, 'a'),
  projectId: `proj${n}`,
  workOrderId: `wo${n}`,
  name: `Work ${n}`,
  priceMinor: 120000,
  deadline: Date.parse('2026-11-01T00:00:00Z'),
  currency: 'USD',
  profile: 'code.milestone@1',
  version: 3,
  simulated: true,
  ...over,
});
const page = (orders: unknown[], nextCursor: string | null = null) => ({ orders, nextCursor, simulated: true });

describe('BoardPanel (T-0275)', () => {
  it('asks people to sign in before loading anything', () => {
    const calls = api(() => ({ body: page([]) }));
    render(<BoardPanel enabled={false} generation={0} onOpen={() => undefined} />);
    expect(screen.getByRole('status').textContent).toBe('Sign in to load posted work.');
    expect(screen.getByText('SIMULATED BOARD')).toBeTruthy();
    expect(calls).toEqual([]);
  });

  it('pages, filters, moves between cards with the keyboard, and opens a claimed project', async () => {
    const calls = api((c) => {
      if (c.method === 'POST') return { body: { id: 'proj1', version: 4, accepted: true, simulated: true } };
      return c.path.includes('after=c1')
        ? { body: page([offer(2, { name: 'Second job', currency: 'GBP' })]) }
        : { body: page([offer(1), offer(3, { name: 'Third job' })], 'c1') };
    });
    const onOpen = vi.fn();
    render(<BoardPanel enabled hosted generation={1} onOpen={onOpen} />);
    expect(screen.getByText('LIVE BOARD')).toBeTruthy();
    await screen.findByText('Work 1');
    expect(screen.getAllByText('$1,200.00').length).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: 'Load more work →' }));
    await screen.findByText('Second job');
    fireEvent.change(screen.getByLabelText('Filter loaded work'), { target: { value: 'gbp' } });
    expect(screen.queryByText('Work 1')).toBeNull();
    fireEvent.change(screen.getByLabelText('Filter loaded work'), { target: { value: '' } });
    const buttons = screen.getAllByRole('button', { name: 'Clock in →' });
    buttons[0]?.focus();
    fireEvent.keyDown(buttons[0] as HTMLElement, { key: 'End' });
    expect(document.activeElement).toBe(buttons.at(-1));
    fireEvent.keyDown(buttons.at(-1) as HTMLElement, { key: 'Home' });
    expect(document.activeElement).toBe(buttons[0]);
    fireEvent.keyDown(buttons[0] as HTMLElement, { key: 'x' });
    expect(document.activeElement).toBe(buttons[0]);
    await act(async () => fireEvent.click(buttons[0] as HTMLElement));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith('proj1'));
    const claim = calls.find((c) => c.method === 'POST');
    expect(claim).toMatchObject({ path: '/blueprints/proj1/work-orders/wo1/claim', body: '{}' });
    expect(claim?.headers.get('If-Match')).toBe('3');
    expect(claim?.headers.get('Idempotency-Key')).toBeTruthy();
  });

  it('never treats a mismatched claim acknowledgement as success, and shows load errors and empty pages', async () => {
    let release: (v: { body: unknown }) => void = () => undefined;
    api((c) => (c.method === 'POST' ? new Promise((r) => (release = r)) : { body: page([offer(1)]) }));
    const onOpen = vi.fn();
    const first = render(<BoardPanel enabled generation={2} onOpen={onOpen} />);
    await screen.findByText('Work 1');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Clock in →' })));
    expect(await screen.findByRole('button', { name: 'Clocking in…' })).toHaveProperty('disabled', true);
    await act(async () => release({ body: { id: 'proj1', version: 9, accepted: true, simulated: true } }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/did not match this work.*No payment is implied/);
    expect(onOpen).not.toHaveBeenCalled();
    first.unmount();

    api(() => ({ status: 503 }));
    const failed = render(<BoardPanel enabled generation={3} onOpen={onOpen} />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not complete this request/);
    failed.unmount();

    api((c) => (c.path.includes('after=') ? { body: page([]) } : { body: page([], 'c9') }));
    const empty = render(<BoardPanel enabled generation={4} onOpen={onOpen} />);
    expect(await screen.findByText('More pages are available below.')).toBeTruthy();
    let next: (v: { body: unknown }) => void = () => undefined;
    api((c) => (c.path.includes('after=') ? new Promise((r) => (next = r)) : { body: page([], 'c9') }));
    fireEvent.click(screen.getByRole('button', { name: 'Load more work →' }));
    expect(await screen.findByRole('button', { name: 'Loading next page…' })).toHaveProperty('disabled', true);
    await act(async () => next({ body: page([]) }));
    expect(await screen.findByText('Try another filter or return after work is posted.')).toBeTruthy();
    empty.unmount();
  });
});
