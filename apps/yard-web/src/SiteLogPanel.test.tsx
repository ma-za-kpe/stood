// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, render, streams } from '../test/harness.js';
import { SiteLogPanel } from './SiteLogPanel.js';

const at = (s: number) => `2026-10-05T00:00:0${s}.000Z`;
const line = (seq: number, payload: object = { kind: 'note', message: `Update ${seq}` }) => ({
  seq,
  actor: 'builder',
  at: at(seq),
  line: payload,
});
const snapshot = {
  version: 3,
  retainedFrom: 2,
  lines: [line(2), line(3, { kind: 'test_run', message: 'Tests', data: { passed: 12, total: 14 } })],
  summary: { through: 1, count: 1, kinds: { punch_list_received: 1 } },
};
const event = (seq: number, payload: object = { kind: 'note', message: `Live ${seq}` }) => ({
  seq,
  actor: 'builder',
  at: at(seq),
  type: 'site_log.line',
  payload,
});
afterEach(() => vi.useRealTimers());

describe('SiteLogPanel (T-0275)', () => {
  it('opens on demand, streams display-only updates and recovers from gaps, bad data and access changes', async () => {
    const all = streams();
    const calls = api(() => ({ body: snapshot }));
    render(<SiteLogPanel projectId="p1" workOrderId="wo1" generation={0} />);
    expect(calls).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Show site log' }));
    await screen.findByText('Update 2');
    expect(screen.getByText('12 / 14 tests passed')).toBeTruthy();
    expect(screen.getByText(/1 earlier updates archived\. punch list received: 1/)).toBeTruthy();
    expect(calls[0]?.path).toBe('/blueprints/p1/work-orders/wo1/log');
    const first = all[0];
    expect(first?.url).toBe('/app/api/blueprints/p1/work-orders/wo1/log/events?since=3&connection=0');
    expect(screen.getByText('Connecting')).toBeTruthy();
    act(() => first?.open());
    expect(screen.getByText('Connected')).toBeTruthy();
    act(() => first?.send('heartbeat'));
    act(() => first?.send('site_log.line', event(4)));
    expect(await screen.findByText('Live 4')).toBeTruthy();
    act(() => first?.fail());
    expect(screen.getByText('Disconnected · last received log')).toBeTruthy();
    // A gap means a missed update: reload the record and reconnect from it.
    act(() => {
      first?.send('site_log.line', event(9));
      // Anything still arriving on the old stream during the refresh is ignored.
      first?.send('site_log.line', event(5));
      first?.send('snapshot.required');
    });
    await waitFor(() => expect(all.length).toBe(2));
    expect(first?.closed).toBe(true);
    act(() => all[1]?.send('site_log.line', 'not json'));
    await waitFor(() => expect(all.length).toBe(3));
    act(() => all[2]?.send('snapshot.required'));
    await waitFor(() => expect(all.length).toBe(4));
    act(() => all[3]?.send('authorization.required'));
    await waitFor(() => expect(all.length).toBe(5));
    // Soft refreshes reconnect with a new counter; a full reset reconnects once the server record is back.
    // Every reconnect resumes from the server's record, not from an update the page held on its own.
    const queries = all.map((stream) => new URLSearchParams(stream.url.split('?')[1]));
    expect(queries.every((q) => q.get('since') === '3')).toBe(true);
    const counters = queries.map((q) => Number(q.get('connection')));
    expect(counters).toEqual([...counters].sort((x, y) => x - y));
    expect(counters.at(-1)).toBeGreaterThanOrEqual(2);
    // The reason stays visible until the stream reconnects.
    expect(screen.getByText('Access needs checking')).toBeTruthy();
    act(() => all[4]?.open());
    expect(screen.getByText('Connected')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hide site log' }));
    expect(all[4]?.closed).toBe(true);
  });

  it('refreshes a silent stream, follows or pauses scrolling, and shows empty and failed logs', async () => {
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const all = streams();
    api(() => ({ body: snapshot }));
    render(<SiteLogPanel projectId="p1" workOrderId="wo1" generation={1} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show site log' }));
    await screen.findByText('Update 2');
    // A watchdog check on a stream that is still talking leaves it alone.
    await act(async () => vi.advanceTimersByTime(5000));
    expect(all.length).toBe(1);
    now += 36_000;
    await act(async () => vi.advanceTimersByTime(5000));
    vi.useRealTimers();
    await waitFor(() => expect(all.length).toBe(2));
    const viewport = screen.getByLabelText('Build updates');
    Object.defineProperty(viewport, 'scrollHeight', { value: 500, configurable: true });
    Object.defineProperty(viewport, 'clientHeight', { value: 100, configurable: true });
    viewport.scrollTop = 390;
    fireEvent.scroll(viewport);
    expect(screen.getByRole('button', { name: 'Pause scrolling' })).toBeTruthy();
    viewport.scrollTop = 0;
    fireEvent.scroll(viewport);
    expect(screen.getByRole('button', { name: 'Follow latest' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Follow latest' }));
    expect(screen.getByRole('button', { name: 'Pause scrolling' })).toBeTruthy();
    vi.useRealTimers();
  });

  it('says when nothing is retained yet, and when the log cannot be read', async () => {
    streams();
    api(() => ({ body: { version: 0, retainedFrom: 1, lines: [], summary: null } }));
    const empty = render(<SiteLogPanel projectId="p1" workOrderId="wo1" generation={2} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show site log' }));
    expect(await screen.findByText('No retained build updates yet.')).toBeTruthy();
    empty.unmount();
    api(() => ({ status: 403 }));
    render(<SiteLogPanel projectId="p1" workOrderId="wo1" generation={3} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show site log' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/does not have access/);
  });
});
