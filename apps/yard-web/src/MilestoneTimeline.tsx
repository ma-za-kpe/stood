import { BryntumGantt, type BryntumGanttProps } from '@bryntum/gantt-react';
import { timelineTasks } from './c5-integrations.js';
import type { ProjectRoom } from './project-state.js';
import '@bryntum/gantt/gantt.css';
import '@bryntum/gantt/stockholm-dark.css';

export function MilestoneTimeline({ room }: { room: ProjectRoom }) {
  const tasks = timelineTasks(room).map((task) => ({ ...task, startDate: new Date(task.startDate) }));
  const props: BryntumGanttProps = {
    readOnly: true,
    startDate: new Date(Math.min(...tasks.map((task) => task.startDate.getTime())) - 86_400_000),
    endDate: new Date(Math.max(...tasks.map((task) => task.startDate.getTime())) + 86_400_000),
    columns: [{ type: 'name', field: 'name', width: 300 }],
    viewPreset: 'weekAndDayLetter',
    project: {
      autoLoad: false,
      autoSync: false,
      tasksData: tasks,
    },
  };
  if (!tasks.length)
    return (
      <section aria-label="Milestone timeline">
        <h3>Milestone timeline</h3>
        <p>No milestones are posted yet.</p>
      </section>
    );
  return (
    <section aria-label="Milestone timeline" className="partner-timeline">
      <div>
        <p className="eyebrow">Bryntum Gantt · read-only</p>
        <h3>Milestones and release gates</h3>
        <p className="fine">Unreleased milestones are locked. This timeline cannot change scope, status, or payment.</p>
      </div>
      <div className="partner-timeline__canvas">
        <BryntumGantt {...props} />
      </div>
      <ul className="partner-timeline__legend">
        {room.orders.map((order) => (
          <li key={order.id}>
            <span>{order.state === 'PAID' ? 'Released' : 'Locked'}</span> · {order.name} · due{' '}
            {new Date(order.deadline).toISOString().slice(0, 10)}
          </li>
        ))}
      </ul>
    </section>
  );
}
