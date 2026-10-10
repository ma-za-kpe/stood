// @vitest-environment jsdom
import { BUYER_HANDOVER_ITEMS, HANDOVER_CHECKLIST } from '@stood/yard-contracts';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { api, order, render } from '../test/harness.js';
import { CostBreakdown } from './CostBreakdown.js';
import { HandoverPanel } from './HandoverPanel.js';
import { roomChecked } from './project-state.js';

const room = (states: string[], handover: unknown = null) =>
  roomChecked({
    id: 'p1',
    version: 9,
    summary: 's',
    currency: 'USD',
    simulated: true,
    handover,
    orders: states.map((s, i) => order(s, i)),
  });

describe('CostBreakdown (T-0275)', () => {
  it('refuses to present costs that do not add up to the cap', () => {
    render(<CostBreakdown blueprint={{ budgetMinor: 1000, currency: 'USD', costLines: [] } as never} />);
    expect(screen.getByRole('alert').textContent).toMatch(/don’t add up/);
  });
  it('lists every cost and the total against the approved cap', () => {
    render(
      <CostBreakdown
        blueprint={{ capMinor: 120000, currency: 'USD', milestones: [{ budgetMinor: 60000 }, { budgetMinor: 60000 }] }}
      />,
    );
    expect(screen.getByText('Builder milestones')).toBeTruthy();
    expect(screen.getByText(/Total: \$1,200\.00 of your \$1,200\.00 approved cap/)).toBeTruthy();
  });
});

describe('HandoverPanel (T-0275)', () => {
  const buyerItems = HANDOVER_CHECKLIST.filter((i) => i.owner !== 'YARD');
  it('lets the buyer close only after every milestone is paid and every item is ticked', async () => {
    const calls = api(() => ({ body: { ok: true } }));
    render(<HandoverPanel room={room(['PAID'])} buyer />);
    const close = screen.getByRole('button', { name: 'Close the project' });
    expect(close).toHaveProperty('disabled', true);
    expect(screen.getByRole('status').textContent).toMatch(/Tick every item/);
    for (const item of buyerItems) fireEvent.click(screen.getByLabelText(item.label));
    fireEvent.click(screen.getByLabelText(buyerItems[0]?.label ?? ''));
    fireEvent.click(screen.getByLabelText(buyerItems[0]?.label ?? ''));
    expect(screen.getByRole('status').textContent).toBe('Ready to close.');
    await act(async () => fireEvent.click(close));
    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/blueprints/p1/handover' });
    expect(JSON.parse(calls[0]?.body ?? '')).toEqual({ confirmed: buyerItems.map((i) => i.id).sort() });
    expect(calls[0]?.headers.get('If-Match')).toBe('9');
    expect(calls[0]?.headers.get('Idempotency-Key')).toMatch(/^handover-/);
  });
  it('explains unpaid work, reports a failed close, and shows a closed project read-only', async () => {
    api(() => ({ status: 409 }));
    const { unmount } = render(<HandoverPanel room={room(['CHECKING'])} buyer />);
    expect(screen.getByRole('status').textContent).toMatch(/must be paid/);
    unmount();
    // While the close is in flight the button says so and cannot be pressed twice.
    let release: (v: { status: number }) => void = () => undefined;
    api(() => new Promise((r) => (release = r)));
    const pending = render(<HandoverPanel room={room(['PAID'])} buyer />);
    for (const item of buyerItems) fireEvent.click(screen.getByLabelText(item.label));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Close the project' })));
    expect(await screen.findByRole('button', { name: 'Closing…' })).toHaveProperty('disabled', true);
    await act(async () => release({ status: 409 }));
    pending.unmount();
    api(() => ({ status: 409 }));
    render(<HandoverPanel room={room(['PAID'])} buyer />);
    for (const item of buyerItems) fireEvent.click(screen.getByLabelText(item.label));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Close the project' })));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/work changed/));
  });
  it('shows a closed project and keeps a builder read-only', () => {
    const closedAt = Date.parse('2026-10-08T12:30:00Z');
    const { unmount } = render(
      <HandoverPanel
        room={room(['PAID'], { status: 'CLOSED', closedAt, confirmed: [...BUYER_HANDOVER_ITEMS] })}
        buyer
      />,
    );
    expect(screen.getByText('Closed. The keys are yours.')).toBeTruthy();
    expect(screen.getByText(/Closed 2026-10-08 12:30 UTC/)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    unmount();
    render(<HandoverPanel room={room(['PAID'])} buyer={false} />);
    expect(screen.queryByRole('button')).toBeNull();
    for (const box of screen.getAllByRole('checkbox')) expect(box).toHaveProperty('disabled', true);
  });
});

// C4 (#77): the final milestone is paid only after the buyer confirms use; Stood's answer is shown as it arrives.
describe('HandoverPanel usage confirmation', () => {
  const delivered = (usage: unknown = null) =>
    roomChecked({
      id: 'p1',
      version: 9,
      summary: 's',
      currency: 'USD',
      simulated: true,
      handover: null,
      orders: [
        order('PAID', 0),
        { ...order('CHECKING', 1), final: true, usage, submission: { packageId: 'p2', commit: 'b'.repeat(40) } },
      ],
    });
  it('lets the buyer confirm use of the delivered final milestone, once', async () => {
    const calls = api(() => ({ body: { ok: true } }));
    render(<HandoverPanel room={delivered()} buyer />);
    expect(screen.getByText(/Milestone 2 is delivered/)).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'I’m using Milestone 2' })));
    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/blueprints/p1/work-orders/o1/usage', body: '{}' });
    expect(calls[0]?.headers.get('If-Match')).toBe('9');
    expect(calls[0]?.headers.get('Idempotency-Key')).toMatch(/^usage-/);
  });
  it('shows Stood’s answer, a failed confirmation, and a builder’s read-only view', async () => {
    for (const [status, text] of [
      ['CONFIRMED', /Yard is sending that to Stood/],
      ['ACCEPTED', /Stood accepted your confirmation/],
      ['REFUSED', /did not accept/],
    ] as const) {
      const { unmount } = render(<HandoverPanel room={delivered({ confirmedAt: 1, status })} buyer />);
      expect(screen.getAllByRole('status').some((n) => text.test(n.textContent ?? ''))).toBe(true);
      unmount();
    }
    let release: (v: { status: number }) => void = () => undefined;
    api(() => new Promise((r) => (release = r)));
    const { unmount } = render(<HandoverPanel room={delivered()} buyer />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'I’m using Milestone 2' })));
    expect(await screen.findByRole('button', { name: 'Confirming…' })).toHaveProperty('disabled', true);
    await act(async () => release({ status: 409 }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    unmount();
    render(<HandoverPanel room={delivered()} buyer={false} />);
    expect(screen.getByText('Milestone 2: waiting for the buyer to confirm use.')).toBeTruthy();
  });
  it('refuses a room with an invalid final flag or usage', () => {
    const bad = (o: object) => () =>
      roomChecked({
        id: 'p1',
        version: 1,
        summary: 's',
        currency: 'USD',
        simulated: true,
        orders: [{ ...order('CHECKING', 0), ...o }],
      });
    expect(bad({ final: 'yes' })).toThrow('Invalid final flag');
    expect(bad({ usage: { confirmedAt: 1, status: 'PAID' } })).toThrow('Invalid usage');
    expect(bad({ usage: 'x' })).toThrow('Invalid usage');
  });
});
