// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, type Call, render, streams } from '../test/harness.js';
import { App } from './App.js';

afterEach(() => {
  window.history.replaceState(null, '', '/');
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const click = async (name: string | RegExp) => {
  await act(async () => fireEvent.click(screen.getByRole('button', { name })));
};
const refusal = (final: boolean) => ({ packageId: 'p0', reference: 'ref', attempt: 1, final });
const punch = [{ field: 'tests', reason: 'Two signed tests fail' }];
const room = (version = 5) => ({
  id: 'proj1',
  version,
  summary: 'Salon bookings',
  currency: 'USD',
  simulated: true,
  clock: Date.parse('2026-10-05T00:00:00Z'),
  orders: [
    {
      id: 'o1',
      name: 'Setup',
      state: 'PAID',
      budgetMinor: 1000,
      trancheId: 't1',
      payment: {
        trancheId: 't1',
        packageId: 'p1',
        reference: 'r',
        effect: 'CAPTURE',
        minor: 1000,
        currency: 'USD',
        simulated: true,
      },
      submission: { packageId: 'p1', commit: 'a'.repeat(40) },
      leasedUntil: null,
      attempt: 2,
      refusals: [refusal(false)],
      tests: { ids: ['a', 'b'], bundleHash: 'f'.repeat(64) },
    },
    {
      id: 'o2',
      name: 'Bookings',
      state: 'REWORK',
      budgetMinor: 1000,
      trancheId: 't2',
      payment: null,
      submission: null,
      leasedUntil: null,
      attempt: 2,
      punchList: punch,
      refusals: [refusal(false)],
    },
    {
      id: 'o3',
      name: 'Reports',
      state: 'REFUSED',
      budgetMinor: 1000,
      trancheId: 't3',
      payment: null,
      submission: null,
      leasedUntil: null,
      punchList: punch,
      refusals: [refusal(true)],
    },
    {
      id: 'o4',
      name: 'Checks',
      state: 'CHECKING',
      budgetMinor: 1000,
      trancheId: 't4',
      payment: null,
      submission: { packageId: 'p4', commit: 'b'.repeat(40) },
      leasedUntil: Date.parse('2026-10-06T12:00:00Z'),
    },
    {
      id: 'o5',
      name: 'Saving',
      state: 'SUBMITTING',
      budgetMinor: 1000,
      trancheId: 't5',
      payment: null,
      submission: null,
      leasedUntil: null,
    },
    {
      id: 'o6',
      name: 'Claimed',
      state: 'CLAIMED',
      budgetMinor: 1000,
      trancheId: 't6',
      payment: null,
      submission: null,
      leasedUntil: Date.parse('2026-10-06T00:00:00Z'),
    },
  ],
});
// A local-run Yard server: demo sessions, one project room, empty side panels.
function local(over: (c: Call) => { status?: number; body?: unknown } | undefined = () => undefined) {
  let role: string | null = null;
  let version = 5;
  return api((c) => {
    const custom = over(c);
    if (custom) return custom;
    if (c.path === '/session') return { body: { mode: 'mock', role } };
    if (c.path === '/demo/session') {
      role = JSON.parse(c.body).role;
      return { body: { role, simulated: true } };
    }
    if (c.path === '/blueprints/proj1/room') return { body: room(version++ && 5) };
    if (c.path.startsWith('/blueprints/proj1/secrets')) return { body: { secrets: [], simulated: true } };
    if (c.path.startsWith('/board')) return { body: { orders: [], nextCursor: null, simulated: true } };
    if (c.path === '/research/ideas')
      return {
        body: {
          items: [],
          attribution: {
            required: true,
            text: 'Research by StartupTribunal',
            url: 'https://startuptribunal.com/catalog',
          },
        },
      };
    return { status: 404 };
  });
}

describe('App (T-0275)', () => {
  it('signs in with an access code on hosted Yard, explains refusals, and signs out', async () => {
    streams();
    let role: string | null = null;
    let reply: { status?: number; body?: unknown } | null = null;
    const calls = api((c) => {
      if (c.path === '/session' && c.method === 'POST') {
        if (reply) return reply;
        role = 'buyer';
        return { body: { mode: 'hosted', role } };
      }
      if (c.path === '/session' && c.method === 'DELETE') {
        role = null;
        return reply ?? { body: { mode: 'hosted', role } };
      }
      if (c.path === '/session') return { body: { mode: 'hosted', role } };
      if (c.path === '/research/ideas')
        return {
          body: {
            items: [],
            attribution: {
              required: true,
              text: 'Research by StartupTribunal',
              url: 'https://startuptribunal.com/catalog',
            },
          },
        };
      return { body: { orders: [], nextCursor: null, simulated: true } };
    });
    render(<App />);
    expect(screen.getByText('CONNECTING')).toBeTruthy();
    await screen.findByText('LIVE');
    expect(screen.getByText('What will you build?')).toBeTruthy();
    const code = screen.getByLabelText('Access code');
    fireEvent.change(code, { target: { value: 'x'.repeat(30) } });
    reply = { status: 401 };
    await act(async () => fireEvent.submit(code.closest('form') as HTMLFormElement));
    expect((await screen.findByRole('alert')).textContent).toBe('That access code was not accepted.');
    reply = { status: 429 };
    await act(async () => fireEvent.submit(code.closest('form') as HTMLFormElement));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Too many attempts/);
    reply = { body: { mode: 'hosted', role: null } };
    await act(async () => fireEvent.submit(code.closest('form') as HTMLFormElement));
    expect((await screen.findByRole('alert')).textContent).toBe('That access code was not accepted.');
    reply = null;
    // A second submit while signing in is still running is ignored.
    await act(async () => {
      fireEvent.submit(code.closest('form') as HTMLFormElement);
      fireEvent.submit(code.closest('form') as HTMLFormElement);
    });
    expect(await screen.findByText('Signed in as the buyer.')).toBeTruthy();
    expect(JSON.parse(calls.filter((c) => c.method === 'POST' && c.path === '/session').at(-1)?.body ?? '')).toEqual({
      access_code: 'x'.repeat(30),
    });
    await click('The Board');
    expect(screen.getByText('Find your next work order.')).toBeTruthy();
    await click('Project room');
    expect(screen.getByText(/Open a project from the Board when work is posted/)).toBeTruthy();
    await click('Paper theme');
    expect(document.querySelector('.app')?.getAttribute('data-theme')).toBe('paper');
    await click('Dark theme');
    reply = { status: 500 };
    await click('Sign out');
    expect((await screen.findByRole('alert')).textContent).toBe('Sign-out could not be confirmed. Try again.');
    reply = null;
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
      fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    });
    expect(await screen.findByLabelText('Access code')).toBeTruthy();
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(2);
  });

  it('ends a hosted session the server no longer recognises', async () => {
    streams();
    let role: string | null = 'builder';
    api((c) =>
      c.path === '/session'
        ? { body: { mode: 'hosted', role } }
        : { body: { orders: [], nextCursor: null, simulated: true } },
    );
    const { client } = render(<App />);
    expect(await screen.findByText('Signed in as the builder.')).toBeTruthy();
    role = null;
    await act(async () => client.invalidateQueries({ queryKey: ['session'] }));
    expect(await screen.findByLabelText('Access code')).toBeTruthy();
  });

  it('runs a local project room: operators, every milestone state, and the live room stream', async () => {
    window.history.replaceState(null, '', '?project=proj1');
    const all = streams();
    local();
    render(<App />);
    await screen.findByText('SIMULATED');
    expect(screen.getByText('Work in motion.')).toBeTruthy();
    expect(
      screen.getByText(/Choose a simulated operator, then open a project created by the local journey/),
    ).toBeTruthy();
    await click('Buyer');
    expect(await screen.findByText('Salon bookings')).toBeTruthy();
    expect(screen.getByText(/Paid on attempt 2, after 1 Stood refusal/)).toBeTruthy();
    expect(screen.getByText(/Back to the builder for attempt 2/)).toBeTruthy();
    expect(screen.getByText('Refused with no attempts left. Nothing was paid.')).toBeTruthy();
    expect(screen.getAllByText('Two signed tests fail')).toHaveLength(2);
    expect(screen.getByText('Submitted for Stood to check. Held, not paid.')).toBeTruthy();
    expect(screen.getByText(/Waiting for its matching package receipt/)).toBeTruthy();
    expect(screen.getByText(/server owns this milestone/)).toBeTruthy();
    expect(screen.getByText(/Signed tests \(read-only\): a, b/)).toBeTruthy();
    expect(screen.getByText(/ends 2026-10-06 12:00 UTC/)).toBeTruthy();
    expect(screen.getByText('Test keys')).toBeTruthy();
    // The room stream resumes from each applied version, so always talk to the newest one.
    const latest = () => all.filter((x) => x.url.startsWith('/app/api/blueprints/proj1/events')).at(-1);
    expect(latest()?.url).toBe('/app/api/blueprints/proj1/events?since=5&connection=0');
    expect(screen.getByText(/Connecting/)).toBeTruthy();
    act(() => latest()?.open());
    expect(screen.getByText('Connected')).toBeTruthy();
    act(() => latest()?.send('heartbeat'));
    act(() => latest()?.send('wo.building', { seq: 6, actor: 'builder', payload: { wo: 'o6', state: 'BUILDING' } }));
    expect(await screen.findByText('BUILDING')).toBeTruthy();
    await waitFor(() => expect(latest()?.url).toMatch(/since=6/));
    act(() => latest()?.send('yard.private', { seq: 7 }));
    await waitFor(() => expect(latest()?.url).toMatch(/since=7/));
    act(() => latest()?.fail());
    expect(screen.getByText(/Disconnected · last received state/)).toBeTruthy();
    // Anything out of order, malformed or a server reset reloads the room from its record.
    for (const send of [
      () => latest()?.send('wo.claimed', { seq: 99, actor: 'builder', payload: { wo: 'o6' } }),
      () => latest()?.send('wo.claimed', 'not json'),
    ]) {
      act(send);
      expect(await screen.findByText(/Reloading record|Loading the latest project record/)).toBeTruthy();
    }
    const last = latest();
    act(() => last?.send('snapshot.required'));
    expect(last?.closed).toBe(true);
  });

  it('reconnects a silent room stream, validates project IDs and opens projects from the Board', async () => {
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    // Capture the room watchdog (registered every five seconds) so the test can run it on demand.
    const watchdogs: (() => void)[] = [];
    const setInterval = window.setInterval.bind(window);
    vi.spyOn(window, 'setInterval').mockImplementation(((fn: () => void, ms?: number) => {
      if (ms === 5_000) watchdogs.push(fn);
      return setInterval(fn, ms);
    }) as typeof window.setInterval);
    const all = streams();
    local((c) =>
      c.path.startsWith('/board')
        ? {
            body: {
              orders: [
                {
                  id: 'a'.repeat(64),
                  projectId: 'proj1',
                  workOrderId: 'o6',
                  name: 'Claim me',
                  priceMinor: 1000,
                  deadline: 1,
                  currency: 'USD',
                  profile: 'code.milestone@1',
                  version: 5,
                  simulated: true,
                },
              ],
              nextCursor: null,
              simulated: true,
            },
          }
        : c.path.endsWith('/claim')
          ? { body: { id: 'proj1', version: 6, accepted: true, simulated: true } }
          : undefined,
    );
    render(<App />);
    await screen.findByText('SIMULATED');
    await click('Builder');
    await click('Project room');
    const input = screen.getByLabelText('Project ID');
    await act(async () => fireEvent.submit(input.closest('form') as HTMLFormElement));
    expect((await screen.findByRole('alert')).textContent).toBe('Enter a project ID.');
    fireEvent.change(input, { target: { value: 'bad id!' } });
    await act(async () => fireEvent.submit(input.closest('form') as HTMLFormElement));
    expect((await screen.findByRole('alert')).textContent).toBe('Use the project ID from the Board.');
    fireEvent.change(input, { target: { value: 'proj1' } });
    await act(async () => fireEvent.submit(input.closest('form') as HTMLFormElement));
    expect(await screen.findByText('Salon bookings')).toBeTruthy();
    expect(window.location.search).toBe('?project=proj1');
    await click('Describe a project');
    expect(screen.getByText('What will you build?')).toBeTruthy();
    await click('The Board');
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: 'Clock in →' })));
    expect(await screen.findByText('Salon bookings')).toBeTruthy();
    expect(window.location.search).toBe('?project=proj1');
    expect(screen.queryByText('Test keys')).toBeNull();
    const before = all.length;
    now += 36_000;
    await act(async () => watchdogs.at(-1)?.());
    await waitFor(() => expect(all.length).toBeGreaterThan(before));
    expect(all.at(-1)?.url).toMatch(/connection=1$/);
  });

  it('says when this copy cannot reach Yard, and when a demo operator is not confirmed', async () => {
    streams();
    api((c) => (c.path === '/session' ? { status: 503 } : { status: 404 }));
    const { unmount } = render(<App />);
    expect(await screen.findByText('PREVIEW')).toBeTruthy();
    expect(screen.getByText('Connecting to Yard…')).toBeTruthy();
    unmount();
    local((c) => (c.path === '/demo/session' ? { body: { role: 'builder', simulated: true } } : undefined));
    render(<App />);
    await screen.findByText('SIMULATED');
    await click('Buyer');
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not be confirmed/);
  });

  it('shows refusal history, rework and leases without a server clock, and a room that cannot load', async () => {
    window.history.replaceState(null, '', '?project=proj1');
    const all = streams();
    const variant = room();
    const orders = variant.orders as Record<string, unknown>[];
    orders[0] = { ...orders[0], attempt: undefined, refusals: [refusal(false), refusal(false)] };
    orders[1] = { ...orders[1], attempt: undefined };
    const noClock: Record<string, unknown> = { ...variant };
    delete noClock.clock;
    let roomReply: { status?: number; body?: unknown } = { body: noClock };
    local((c) => (c.path === '/blueprints/proj1/room' ? roomReply : undefined));
    const view = render(<App />);
    await screen.findByText('SIMULATED');
    // A second click while the first switch is still running is ignored.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Builder' }));
      fireEvent.click(screen.getByRole('button', { name: 'Builder' }));
    });
    expect(await screen.findByText(/Paid on attempt 3, after 2 Stood refusals/)).toBeTruthy();
    expect(screen.getByText(/Back to the builder for attempt 2/)).toBeTruthy();
    expect(screen.getByText(/\(ends 2026-10-06 00:00 UTC\)/)).toBeTruthy();
    const latest = () => all.filter((x) => x.url.includes('/blueprints/proj1/events')).at(-1);
    act(() => latest()?.open());
    act(() => latest()?.send('wo.claimed', { seq: 99, actor: 'builder', payload: { wo: 'o6' } }));
    expect(await screen.findByText(/Reloading record/)).toBeTruthy();
    view.unmount();
    roomReply = { status: 503 };
    render(<App />);
    await screen.findByText('SIMULATED');
    await click('Buyer');
    expect((await screen.findAllByRole('alert')).some((a) => /could not complete/.test(a.textContent ?? ''))).toBe(
      true,
    );
  });

  it('keeps a healthy room stream open when the watchdog checks it', async () => {
    window.history.replaceState(null, '', '?project=proj1');
    const watchdogs: (() => void)[] = [];
    const setInterval = window.setInterval.bind(window);
    vi.spyOn(window, 'setInterval').mockImplementation(((fn: () => void, ms?: number) => {
      if (ms === 5_000) watchdogs.push(fn);
      return setInterval(fn, ms);
    }) as typeof window.setInterval);
    const all = streams();
    local();
    render(<App />);
    await screen.findByText('SIMULATED');
    await click('Buyer');
    await screen.findByText('Salon bookings');
    const before = all.length;
    await act(async () => watchdogs.at(-1)?.());
    expect(all.length).toBe(before);
  });
});
