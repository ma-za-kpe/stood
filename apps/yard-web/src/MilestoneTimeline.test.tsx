// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { render } from '../test/harness.js';
import { MilestoneTimeline } from './MilestoneTimeline.js';
import type { ProjectRoom } from './project-state.js';

vi.mock('@bryntum/gantt-react', () => ({
  BryntumGantt: (props: { readOnly: boolean; project: { tasksData: unknown[] } }) => (
    <div data-testid="gantt" data-read-only={String(props.readOnly)} data-tasks={props.project.tasksData.length} />
  ),
}));

const room = (orders: ProjectRoom['orders']): ProjectRoom => ({
  id: 'p1',
  version: 1,
  summary: 'private summary',
  currency: 'USD',
  simulated: true,
  orders,
});

it('explains when a project has no milestones', () => {
  render(<MilestoneTimeline room={room([])} />);
  expect(screen.getByRole('heading', { name: 'Milestone timeline' })).toBeTruthy();
  expect(screen.getByText('No milestones are posted yet.')).toBeTruthy();
});

it('shows paid and locked milestones in a read-only Gantt', () => {
  render(
    <MilestoneTimeline
      room={room([
        {
          id: 'o1',
          name: 'First milestone',
          state: 'PAID',
          budgetMinor: 1000,
          trancheId: 't1',
          deadline: Date.parse('2026-10-20T00:00:00Z'),
          payment: null,
          submission: null,
          leasedUntil: null,
        },
        {
          id: 'o2',
          name: 'Second milestone',
          state: 'CHECKING',
          budgetMinor: 1000,
          trancheId: 't2',
          deadline: Date.parse('2026-10-27T00:00:00Z'),
          payment: null,
          submission: null,
          leasedUntil: null,
        },
      ])}
    />,
  );
  expect(screen.getByTestId('gantt').getAttribute('data-read-only')).toBe('true');
  expect(screen.getByTestId('gantt').getAttribute('data-tasks')).toBe('2');
  const legend = screen.getAllByRole('listitem').map((item) => item.textContent ?? '');
  expect(legend.some((line) => line.includes('Released') && line.includes('First milestone'))).toBe(true);
  expect(legend.some((line) => line.includes('Locked') && line.includes('Second milestone'))).toBe(true);
  expect(screen.queryByText('private summary')).toBeNull();
});
