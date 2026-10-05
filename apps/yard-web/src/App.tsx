import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { createActor } from 'xstate';
import { z } from 'zod';
import { create } from 'zustand';
import releasedStamp from '../../../docs/brand/logo/stamp-released.svg';
import logo from '../../../docs/brand/yard/logo/yard-lockup-on-dark.svg';
import { connectionMachine, staleConnection } from './connection.js';
import { applyEvent, type ProjectRoom, type RoomEvent, roomChecked } from './project-state.js';

const useUI = create<{ theme: 'dark' | 'paper'; toggle(): void }>((set) => ({
  theme: 'dark',
  toggle: () => set((s) => ({ theme: s.theme === 'dark' ? 'paper' : 'dark' })),
}));
const projectId = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
async function api(path: string, options?: RequestInit) {
  const response = await fetch(`/app/api${path}`, {
    ...options,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? 'Choose a simulated operator to open the room.'
        : response.status === 404
          ? 'No project with that ID.'
          : 'The service could not complete this request. Retry when it is available.',
    );
  return response.json() as Promise<unknown>;
}
const money = (minor: number, currency: string) =>
  new Intl.NumberFormat('en', { style: 'currency', currency }).format(minor / 100);
function useRoomStream(id: string, version: number, ready: boolean) {
  const client = useQueryClient(),
    [connection, setConnection] = useState('disconnected');
  const [reconnect, setReconnect] = useState(0);
  useEffect(() => {
    if (!ready || !id) return;
    const actor = createActor(connectionMachine).start();
    const subscription = actor.subscribe((s) => setConnection(String(s.value)));
    actor.send({ type: 'CONNECT' });
    const source = new EventSource(
      `/app/api/blueprints/${encodeURIComponent(id)}/events?since=${version}&connection=${reconnect}`,
    );
    const reload = () => {
      actor.send({ type: 'GAP' });
      void client.invalidateQueries({ queryKey: ['room', id] });
    };
    let lastReceived = performance.now();
    const touch = () => {
      lastReceived = performance.now();
    };
    source.onopen = () => {
      touch();
      actor.send({ type: 'CONNECT' });
      actor.send({ type: 'OPEN' });
    };
    source.addEventListener('heartbeat', touch);
    const watchdog = window.setInterval(() => {
      if (staleConnection(lastReceived, performance.now())) {
        source.close();
        actor.send({ type: 'ERROR' });
        setReconnect((value) => value + 1);
        void client.invalidateQueries({ queryKey: ['room', id] });
      }
    }, 5_000);
    source.onerror = () => actor.send({ type: 'ERROR' });
    source.addEventListener('snapshot.required', () => {
      source.close();
      reload();
    });
    const listener = (raw: Event) => {
      touch();
      try {
        const event = JSON.parse((raw as MessageEvent<string>).data) as RoomEvent;
        const current = client.getQueryData<ProjectRoom>(['room', id]);
        if (!current) return reload();
        const next = applyEvent(current, event);
        if (next === 'GAP') reload();
        else client.setQueryData(['room', id], next);
      } catch {
        reload();
      }
    };
    for (const type of [
      'blueprint.ready',
      'blueprint.approved',
      'wo.posted',
      'wo.claimed',
      'wo.building',
      'submission.reserved',
      'wo.submitted',
      'stood.released',
      'stood.refused',
      'wo.lease_expired',
      'wo.reposted',
    ])
      source.addEventListener(type, listener);
    return () => {
      window.clearInterval(watchdog);
      source.close();
      subscription.unsubscribe();
      actor.stop();
    };
  }, [client, id, version, ready, reconnect]);
  return connection;
}
export function App() {
  const [selected, setSelected] = useState(new URLSearchParams(window.location.search).get('project') ?? '');
  const [session, setSession] = useState(false),
    [sessionError, setSessionError] = useState('');
  const { theme, toggle } = useUI(),
    {
      register,
      handleSubmit,
      formState: { errors },
      setError,
    } = useForm<{ id: string }>({ defaultValues: { id: selected } });
  const room = useQuery({
    queryKey: ['room', selected],
    enabled: session && !!selected,
    queryFn: async () => roomChecked(await api(`/blueprints/${encodeURIComponent(selected)}/room`)),
  });
  const connection = useRoomStream(selected, room.data?.version ?? 0, !!room.data);
  const choose = async (role: 'buyer' | 'builder') => {
    try {
      await api('/demo/session', { method: 'POST', body: JSON.stringify({ role }) });
      setSession(true);
      setSessionError('');
      if (selected) await room.refetch();
    } catch (e) {
      setSessionError((e as Error).message);
    }
  };
  return (
    <div className="app" data-theme={theme}>
      <a className="skip" href="#main">
        Skip to project
      </a>
      <header className="masthead">
        <a href="/yard/">
          <img src={logo} alt="Yard" width="145" height="40" />
        </a>
        <nav aria-label="Product navigation">
          <a href="/">Stood ↗</a>
          <a href="/yard/">Yard story</a>
          <button type="button" onClick={toggle}>
            {theme === 'dark' ? 'Paper theme' : 'Dark theme'}
          </button>
        </nav>
      </header>
      <aside className="simulation" role="note">
        <span className="signal">SIMULATED</span> Local providers and synthetic evidence. No real payment is executed.
        Live integrations wait for keys and qualification.
      </aside>
      <main id="main">
        <div className="room-intro">
          <div>
            <p className="eyebrow">Yard / project room</p>
            <h1>
              Work in motion.
              <br />
              <em>Money with proof.</em>
            </h1>
            <p className="lede">
              A real service stream, with simulated providers. Stood decides the payment; Yard shows the build.
            </p>
          </div>
          <div className="operator-card">
            <fieldset>
              <legend>Demo operator</legend>
              <button type="button" onClick={() => void choose('buyer')}>
                Buyer
              </button>
              <button type="button" onClick={() => void choose('builder')}>
                Builder
              </button>
            </fieldset>
            <p className="fine">Synthetic accounts only. Operator keys stay on the server.</p>
            {sessionError && <p role="alert">{sessionError}</p>}
          </div>
        </div>
        <form
          className="room-picker"
          onSubmit={handleSubmit(({ id }) => {
            if (!projectId.safeParse(id).success) {
              setError('id', { message: 'Use the project ID from the Board.' });
              return;
            }
            setSelected(id);
            window.history.replaceState(null, '', `?project=${encodeURIComponent(id)}`);
          })}
        >
          <label htmlFor="project-id">Project ID</label>
          <input
            id="project-id"
            {...register('id', { required: 'Enter a project ID.' })}
            placeholder="yard-project"
            autoComplete="off"
          />
          <button type="submit">Open project →</button>
          {errors.id && <p role="alert">{errors.id.message}</p>}
        </form>
        {room.isFetching && <p role="status">Loading the latest project record…</p>}
        {room.error && (
          <p className="error" role="alert">
            {room.error.message}
          </p>
        )}
        {!room.data && !room.isFetching && (
          <section className="empty">
            <div className="grid-mark" aria-hidden="true">
              Y
            </div>
            <h2>Your build belongs here.</h2>
            <p>Choose a simulated operator, then open a project created by the mock journey.</p>
            <p className="fine">This screen does not invent progress or payment.</p>
          </section>
        )}
        {room.data && (
          <>
            <section className="project-head">
              <div>
                <p className="eyebrow">
                  {room.data.id} / revision {room.data.version}
                </p>
                <h2>{room.data.summary}</h2>
              </div>
              <span className={`connection ${connection === 'live' ? 'live' : ''}`} role="status">
                <span aria-hidden="true">●</span>{' '}
                {connection === 'live'
                  ? 'Connected'
                  : connection === 'connecting'
                    ? 'Connecting'
                    : connection === 'reloading'
                      ? 'Reloading record'
                      : 'Disconnected · last received state'}
              </span>
            </section>
            <div className="project-layout">
              <section className="milestones" aria-label="Milestones">
                {room.data.orders.map((o, index) => (
                  <article className={`milestone ${o.state === 'PAID' ? 'completed' : ''}`} key={o.id}>
                    <div className="milestone-number">{String(index + 1).padStart(2, '0')}</div>
                    <div className="milestone-content">
                      <p className="eyebrow">Milestone {index + 1}</p>
                      <h3>{o.name}</h3>
                      <p className="budget">{money(o.budgetMinor, room.data.currency)}</p>
                      {o.state === 'PAID' ? (
                        <div className="stood-verdict">
                          <img className="stamp" src={releasedStamp} alt="Stood / Released" width="160" height="56" />
                          <p>
                            Simulated capture confirmed. {money(o.budgetMinor, room.data.currency)} recorded as paid.
                          </p>
                        </div>
                      ) : (
                        <>
                          <span className="state-chip">{o.state.replaceAll('_', ' ')}</span>
                          <p className="fine">
                            {o.state === 'CHECKING'
                              ? 'Submitted for Stood to check. Held, not paid.'
                              : o.state === 'SUBMITTING'
                                ? 'Submission saved. Waiting for its matching package receipt.'
                                : 'The server owns this milestone’s current state.'}
                          </p>
                        </>
                      )}
                      {o.submission && <p className="commit">Commit {o.submission.commit.slice(0, 12)}</p>}
                      {o.leasedUntil && (
                        <p className="fine">
                          Lease ends {new Date(o.leasedUntil).toISOString().replace('T', ' ').slice(0, 16)} UTC
                        </p>
                      )}
                    </div>
                  </article>
                ))}
              </section>
              <aside className="truth-panel">
                <p className="eyebrow">Yard builds. Stood pays.</p>
                <h3>
                  A pass is a finding.
                  <br />
                  Payment needs proof.
                </h3>
                <p>
                  Money states arrive from Stood’s matched settlement record. A builder can submit work, never mark it
                  paid.
                </p>
                <hr />
                <p className="eyebrow">Provider mode</p>
                <dl>
                  <dt>Payments</dt>
                  <dd>Simulated</dd>
                  <dt>Crew</dt>
                  <dd>Simulated</dd>
                  <dt>Evidence</dt>
                  <dd>Synthetic fixture</dd>
                </dl>
                <p className="fine">No keys are embedded in this application.</p>
              </aside>
            </div>
          </>
        )}
      </main>
      <footer>
        Yard builds. Stood pays. <a href="/yard/">Back to the Yard →</a>
      </footer>
    </div>
  );
}
