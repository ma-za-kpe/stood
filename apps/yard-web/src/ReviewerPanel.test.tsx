// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import { api, render } from '../test/harness.js';
import type { ProjectRoom } from './project-state.js';
import { ReviewerPanel } from './ReviewerPanel.js';

vi.mock('ag-studio-react', () => ({
  AgStudioProvider: ({ children }: { children: ReactNode }) => <div data-testid="ag-provider">{children}</div>,
  AgStudio: ({ mode }: { mode: string }) => <div data-testid="ag-studio">{mode}</div>,
}));

const room: ProjectRoom = {
  id: 'project-1',
  version: 2,
  summary: 'Do not display the private summary in analytics',
  currency: 'USD',
  simulated: true,
  orders: [
    {
      id: 'wo-1',
      name: 'Milestone 1',
      state: 'PAID',
      budgetMinor: 1000,
      trancheId: 't1',
      deadline: Date.parse('2026-10-20T00:00:00Z'),
      payment: {
        trancheId: 't1',
        packageId: 'p1',
        reference: 'capture-1',
        effect: 'CAPTURE',
        minor: 1000,
        currency: 'USD',
        simulated: true,
      },
      submission: null,
      leasedUntil: null,
    },
    {
      id: 'wo-2',
      name: 'Milestone 2',
      state: 'CHECKING',
      budgetMinor: 2000,
      trancheId: 't2',
      deadline: Date.parse('2026-10-27T00:00:00Z'),
      payment: null,
      submission: null,
      leasedUntil: null,
    },
  ],
};

it('loads runtime license and buyer-only ledger separately and uses the plain fallback when no AG Studio license is configured', async () => {
  const calls = api((call) => {
    if (call.path === '/ag-studio-license') return { body: { state: 'missing' } };
    expect(call.path).toBe('/yard/v1/blueprints/project-1/ledger');
    return {
      body: {
        simulated: true,
        lines: [
          { wo: 'wo-1', currency: 'USD', builderMinor: 1000, capturedMinor: 1000, state: 'HELD_BACK', simulated: true },
          { wo: 'wo-2', currency: 'USD', builderMinor: 2000, capturedMinor: 0, state: 'AUTHORIZED', simulated: true },
        ],
      },
    };
  });
  render(<ReviewerPanel room={room} />);
  expect(await screen.findByRole('heading', { name: 'Payment reconciliation' }, { timeout: 5000 })).toBeTruthy();
  expect(screen.getByText('MATCHED')).toBeTruthy();
  expect(screen.getByText('capture-1')).toBeTruthy();
  expect(screen.getByText('—')).toBeTruthy();
  expect(screen.queryByText(room.summary)).toBeNull();
  expect(calls).toHaveLength(2);
});

it('does not render a reconciled table when the second data source is unavailable', async () => {
  api((call) =>
    call.path === '/ag-studio-license'
      ? { body: { state: 'missing' } }
      : { status: 503, body: { error: 'unavailable' } },
  );
  render(<ReviewerPanel room={room} />);
  expect(await screen.findByRole('alert', {}, { timeout: 5000 })).toBeTruthy();
  await waitFor(() => expect(screen.queryByRole('table')).toBeNull());
});

it('shows the read-only AG Studio dashboard for a current license and warns when it is expiring', async () => {
  for (const [state, expiresAt, warning] of [
    ['licensed', '2027-01-01T00:00:00.000Z', false],
    ['expiring', '2026-10-20T00:00:00.000Z', true],
  ] as const) {
    api((call) =>
      call.path === '/ag-studio-license'
        ? { body: { state, licenseKey: 'runtime-only-license', expiresAt } }
        : {
            body: {
              simulated: true,
              lines: [
                {
                  wo: 'wo-1',
                  currency: 'USD',
                  builderMinor: 1000,
                  capturedMinor: 1000,
                  state: 'CAPTURED',
                  simulated: true,
                },
                {
                  wo: 'wo-2',
                  currency: 'USD',
                  builderMinor: 2000,
                  capturedMinor: 0,
                  state: 'AUTHORIZED',
                  simulated: true,
                },
              ],
            },
          },
    );
    const { unmount } = render(<ReviewerPanel room={room} />);
    expect((await screen.findByTestId('ag-studio', {}, { timeout: 5000 })).textContent).toBe('view');
    expect(screen.getByTestId('ag-provider')).toBeTruthy();
    if (warning) expect(screen.getByText(/trial ends/)).toBeTruthy();
    else expect(screen.queryByText(/trial ends/)).toBeNull();
    unmount();
  }
});
