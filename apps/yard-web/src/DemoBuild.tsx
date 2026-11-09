import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { z } from 'zod';
import { api } from './http.js';

// Demo autopilot (local simulated stack only): one click builds a prewritten project.
// The simulated Crew builds each task; Stood checks it and pays before the next task starts.
export const demoStatus = z.object({
  projectId: z.string().nullable(),
  running: z.boolean(),
  task: z.number().int(),
  total: z.number().int(),
  step: z.string().max(200),
  paid: z.number().int(),
  error: z.string().nullable(),
  simulated: z.literal(true),
});
export type DemoStatus = {
  projectId: string | null;
  running: boolean;
  task: number;
  total: number;
  step: string;
  paid: number;
  error: string | null;
};

export function DemoBuild(props: { ensureBuyer(): Promise<boolean>; onStarted(projectId: string): void }) {
  const [starting, setStarting] = useState(false),
    [error, setError] = useState(''),
    [watching, setWatching] = useState(false);
  const status = useQuery<DemoStatus>({
    queryKey: ['demo-build'],
    refetchInterval: (q) => (q.state.data?.running ? 1_000 : false),
    retry: false,
    queryFn: async ({ signal }): Promise<DemoStatus> =>
      demoStatus.parse(await api('/demo/build', { signal })) as DemoStatus,
    enabled: watching,
  });
  const start = async () => {
    setStarting(true);
    setError('');
    try {
      if (!(await props.ensureBuyer())) throw new Error('The simulated buyer could not be signed in.');
      const started = demoStatus.parse(await api('/demo/build', { method: 'POST' })) as DemoStatus;
      if (!started.projectId) throw new Error('The demo build did not start.');
      props.onStarted(started.projectId);
      setWatching(true);
      void status.refetch();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  };
  const s = status.data;
  return (
    <section className="demo-build" aria-label="Build a project">
      <button type="button" className="primary" disabled={starting || !!s?.running} onClick={() => void start()}>
        {s?.running ? 'Building…' : 'Build a project'}
      </button>
      <p className="fine">Four prewritten tasks. The Crew builds each one; Stood pays after each task passes.</p>
      {s?.projectId && (
        <p role="status" className="demo-progress">
          {s.error
            ? `Stopped: ${s.error}`
            : s.running
              ? `Task ${Math.max(1, s.task)} of ${s.total} · ${s.step} · ${s.paid} paid`
              : `${s.step} · ${s.paid} of ${s.total} paid`}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
