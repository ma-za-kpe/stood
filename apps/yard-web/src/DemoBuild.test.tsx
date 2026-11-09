// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { api, order, render } from '../test/harness.js';
import { DemoBuild } from './DemoBuild.js';
import { roomChecked } from './project-state.js';
import { TransactionsPanel } from './TransactionsPanel.js';

const run = (over: Record<string, unknown> = {}) => ({
  runId: 'r1',
  projectId: 'demo-r1',
  status: 'RUNNING',
  step: 'The Crew builds the menu page',
  task: 2,
  total: 3,
  paid: 1,
  error: null,
  repository: 'ma-za-kpe/yard-sandbox',
  branch: 'wo/demo-r1',
  tasks: [
    { id: 'home', name: 'Home page', state: 'PAID_OUT', commit: 'a'.repeat(40) },
    { id: 'menu', name: 'Menu page', state: 'BUILDING', commit: null },
    { id: 'contact', name: 'Contact page', state: 'WAITING', commit: null },
  ],
  simulated: false,
  ...over,
});

describe('DemoBuild (judge demo)', () => {
  it('starts one build, opens its project and shows each page with its Crew commit', async () => {
    let started = false;
    const calls = api((c) => {
      if (c.method !== 'POST') return { body: { run: started ? run() : null } };
      started = true;
      return { status: 202, body: { run: run() } };
    });
    const onStarted = vi.fn();
    render(<DemoBuild hosted ensureBuyer={async () => true} onStarted={onStarted} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Build a project' }));
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith('demo-r1'));
    expect(await screen.findByText('The Crew builds the menu page')).toBeTruthy();
    expect(screen.getByText('Crew paid')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Crew commit aaaaaaa/ }).getAttribute('href')).toBe(
      `https://github.com/ma-za-kpe/yard-sandbox/commit/${'a'.repeat(40)}`,
    );
    expect(screen.getByRole('link', { name: /See the site/ }).getAttribute('href')).toContain(
      '/tree/wo/demo-r1/public',
    );
    expect((screen.getByRole('button', { name: 'Building…' }) as HTMLButtonElement).disabled).toBe(true);
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });
  it('explains a busy service, a used-up day, a missing buyer and a stopped run', async () => {
    let status = 409;
    api((c) => (c.method === 'POST' ? { status, body: { code: 'x' } } : { body: { run: null } }));
    render(<DemoBuild hosted={false} ensureBuyer={async () => true} onStarted={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Build a project' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/already running/);
    status = 429;
    fireEvent.click(screen.getByRole('button', { name: 'Build a project' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/used up/));
  });
  it('refuses to start without the buyer, and shows a stopped run with its reason', async () => {
    let error: string | null = 'Stood did not release “Menu page”';
    api(() => ({ body: { run: run({ status: 'STOPPED', error }) } }));
    render(<DemoBuild hosted ensureBuyer={async () => false} onStarted={() => {}} />);
    expect(await screen.findByText('Stopped: Stood did not release “Menu page”')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Build another' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Sign in as the buyer/);
    error = null;
  });
  it('shows a stopped run without a reason', async () => {
    api(() => ({ body: { run: run({ status: 'STOPPED', error: null }) } }));
    render(<DemoBuild hosted ensureBuyer={async () => true} onStarted={() => {}} />);
    expect(await screen.findByText('Stopped: see the project room')).toBeTruthy();
  });
  it('reports a start that returned no run', async () => {
    api((c) => (c.method === 'POST' ? { status: 202, body: { run: null } } : { body: { run: null } }));
    render(<DemoBuild hosted ensureBuyer={async () => true} onStarted={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Build a project' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/did not start/);
  });
});

const paidRoom = (reference: string) => {
  const o = order('PAID', 0);
  return roomChecked({
    id: 'demo-r1',
    version: 4,
    summary: 's',
    currency: 'USD',
    simulated: true,
    orders: [{ ...o, payment: { ...o.payment, reference } }, order('POSTED', 1)],
  });
};

describe('DemoBuild room and fee (hosted, 9 Nov)', () => {
  it('opens the latest run room on load, without a new click, so its Transactions show after a reload', async () => {
    api(() => ({
      body: { run: run({ status: 'DONE', paid: 3, step: 'Site built. Every page paid on PayPal sandbox.' }) },
    }));
    const onStarted = vi.fn();
    render(<DemoBuild hosted ensureBuyer={async () => true} onStarted={onStarted} />);
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith('demo-r1'));
    expect(await screen.findByRole('button', { name: 'Build another' })).toBeTruthy();
  });
  it('accepts a capture of the builder price plus the Yard fee, and still refuses one below the price', () => {
    const o = order('PAID', 0);
    const room = (minor: number) => ({
      id: 'demo-r1',
      version: 4,
      summary: 's',
      currency: 'USD',
      simulated: true,
      orders: [{ ...o, payment: { ...o.payment, minor } }],
    });
    // ADR-0027: a real demo page is captured at $1.05 for a $1.00 builder price.
    expect(roomChecked(room(o.budgetMinor + Math.round(o.budgetMinor * 0.05))).orders[0]?.state).toBe('PAID');
    expect(() => roomChecked(room(o.budgetMinor - 1))).toThrow('Missing Stood proof');
    expect(() => roomChecked(room(1.5))).toThrow('Missing Stood proof');
  });
});

describe('TransactionsPanel (judge demo)', () => {
  it('shows nothing paid before the first capture', () => {
    api(() => ({ body: { lines: [] } }));
    const room = roomChecked({
      id: 'p',
      version: 1,
      summary: 's',
      currency: 'USD',
      simulated: true,
      orders: [order('POSTED', 0)],
    });
    render(<TransactionsPanel room={room} simulated />);
    expect(screen.getByText(/Nothing paid yet/)).toBeTruthy();
  });
  it('lists the sandbox capture and the Crew payout with PayPal activity links', async () => {
    api(() => ({
      body: {
        lines: [{ wo: 'o0', state: 'PAID_OUT', builderMinor: 1000, feeMinor: 50, payoutReference: 'PAYOUT12345678' }],
      },
    }));
    render(<TransactionsPanel room={paidRoom('2LU70160P0502522L')} simulated={false} />);
    expect(await screen.findByText(/Crew paid out/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Capture in PayPal ↗' }).getAttribute('href')).toBe(
      'https://www.sandbox.paypal.com/activity/payment/2LU70160P0502522L',
    );
    expect(screen.getByRole('link', { name: 'Payout in PayPal ↗' }).getAttribute('href')).toContain('PAYOUT12345678');
    expect(screen.getByText(/sign in with the sandbox merchant/)).toBeTruthy();
  });
  it('never links a reference that is not a PayPal id, and labels the simulator', () => {
    api(() => ({ body: { lines: [] } }));
    render(<TransactionsPanel room={paidRoom('sim-capture-1')} simulated />);
    expect(screen.getByText(/sandbox simulator/)).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });
  it('shows an unknown payout state as given, and a missing payout id as a dash', async () => {
    api(() => ({
      body: { lines: [{ wo: 'o0', state: 'NEW_STATE', builderMinor: 1000, feeMinor: 0, payoutReference: null }] },
    }));
    render(<TransactionsPanel room={paidRoom('not-an-id')} simulated={false} />);
    expect(await screen.findByText(/NEW_STATE/)).toBeTruthy();
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
