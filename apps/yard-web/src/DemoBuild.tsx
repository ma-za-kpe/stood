import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { z } from 'zod';
import { ApiError, api } from './http.js';

// Judge demo: one click builds a prewritten three-page website. The Crew is scripted; Stood checks each page
// against frozen tests and pays before the next one starts. Locally the money is simulated; hosted, it is the
// real PayPal sandbox.
const task = z.object({
  id: z.string().max(100),
  name: z.string().max(200),
  state: z.enum(['WAITING', 'FUNDING', 'BUILDING', 'JUDGING', 'CAPTURED', 'PAID_OUT', 'STOPPED']),
  commit: z
    .string()
    .regex(/^[a-f0-9]{40}$/)
    .nullable(),
});
export const demoRun = z.object({
  runId: z.string().max(120),
  projectId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
  status: z.enum(['RUNNING', 'DONE', 'STOPPED']),
  step: z.string().max(300),
  task: z.number().int(),
  total: z.number().int(),
  paid: z.number().int(),
  error: z.string().max(300).nullable(),
  repository: z.string().max(200),
  branch: z.string().max(200),
  tasks: z.array(task).max(20),
  simulated: z.boolean(),
});
export type DemoRunView = {
  runId: string;
  projectId: string;
  status: 'RUNNING' | 'DONE' | 'STOPPED';
  step: string;
  task: number;
  total: number;
  paid: number;
  error: string | null;
  repository: string;
  branch: string;
  tasks: { id: string; name: string; state: TaskState; commit: string | null }[];
  simulated: boolean;
};
const reply = z.object({ run: demoRun.nullable() });
const parse = (v: unknown) => (reply.parse(v).run as DemoRunView | null) ?? null;
type TaskState = 'WAITING' | 'FUNDING' | 'BUILDING' | 'JUDGING' | 'CAPTURED' | 'PAID_OUT' | 'STOPPED';
const LABEL: Record<TaskState, string> = {
  WAITING: 'Waiting',
  FUNDING: 'Holding money',
  BUILDING: 'Crew building',
  JUDGING: 'Stood checking',
  CAPTURED: 'Paid by Stood',
  PAID_OUT: 'Crew paid',
  STOPPED: 'Stopped',
};
const github = (repository: string) => (/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(repository) ? repository : null);

export function DemoBuild(props: {
  ensureBuyer(): Promise<boolean>;
  onStarted(projectId: string): void;
  hosted: boolean;
}) {
  const [starting, setStarting] = useState(false),
    [error, setError] = useState('');
  const status = useQuery<DemoRunView | null>({
    queryKey: ['demo-build'],
    refetchInterval: (q) => (q.state.data?.status === 'RUNNING' ? (props.hosted ? 3_000 : 1_000) : false),
    retry: false,
    queryFn: async ({ signal }) => parse(await api('/demo/build', { signal })),
  });
  const start = async () => {
    setStarting(true);
    setError('');
    try {
      if (!(await props.ensureBuyer())) throw new Error('Sign in as the buyer first.');
      const run = parse(await api('/demo/build', { method: 'POST' }));
      if (!run) throw new Error('The demo build did not start.');
      props.onStarted(run.projectId);
      await status.refetch();
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 409
          ? 'A build is already running. Watch it below.'
          : e instanceof ApiError && e.status === 429
            ? 'Today’s demo builds are used up. Try again tomorrow.'
            : (e as Error).message,
      );
    } finally {
      setStarting(false);
    }
  };
  const run = status.data;
  const repo = run ? github(run.repository) : null;
  return (
    <section className="demo-build" aria-label="Build a project">
      <button
        type="button"
        className="primary"
        disabled={starting || run?.status === 'RUNNING'}
        onClick={() => void start()}
      >
        {run?.status === 'RUNNING' ? 'Building…' : run ? 'Build another' : 'Build a project'}
      </button>
      <p className="fine">
        A café website, page by page. The Crew builds each one; Stood checks it and pays
        {props.hosted ? ' on PayPal sandbox' : ''} before the next begins.
      </p>
      {run && (
        <>
          <p role="status" className="demo-progress">
            {run.status === 'STOPPED' ? `Stopped: ${run.error ?? 'see the project room'}` : run.step}
          </p>
          <ol className="demo-steps">
            {run.tasks.map((t) => (
              <li key={t.id} data-state={t.state}>
                <span>{t.name}</span>
                <span className="demo-state">{LABEL[t.state]}</span>
                {t.commit && repo && (
                  <a href={`https://github.com/${repo}/commit/${t.commit}`} target="_blank" rel="noreferrer">
                    Crew commit {t.commit.slice(0, 7)} ↗
                  </a>
                )}
              </li>
            ))}
          </ol>
          <p className="fine">
            {run.paid} of {run.total} paid
            {repo && run.tasks.some((t) => t.commit) && (
              <>
                {' · '}
                <a href={`https://github.com/${repo}/tree/${run.branch}/public`} target="_blank" rel="noreferrer">
                  See the site’s files ↗
                </a>
              </>
            )}
          </p>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
