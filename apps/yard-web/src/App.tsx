import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { createActor } from 'xstate';
import { z } from 'zod';
import { create } from 'zustand';
import refusedStamp from '../../../docs/brand/logo/stamp-refused.svg';
import releasedStamp from '../../../docs/brand/logo/stamp-released.svg';
import logo from '../../../docs/brand/yard/logo/yard-lockup-on-dark.svg';
import { BoardPanel } from './BoardPanel.js';
import { connectionMachine, staleConnection } from './connection.js';
import { HandoverPanel } from './HandoverPanel.js';
import { api } from './http.js';
import { IntakePanel } from './IntakePanel.js';
import { applyEvent, type ProjectRoom, type RoomEvent, roomChecked } from './project-state.js';
import { SiteLogPanel } from './SiteLogPanel.js';

const useUI = create<{ theme: 'dark' | 'paper'; toggle(): void }>((set) => ({
  theme: 'dark',
  toggle: () => set((s) => ({ theme: s.theme === 'dark' ? 'paper' : 'dark' })),
}));
const projectId = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const money = (minor: number, currency: string) =>
  new Intl.NumberFormat('en', { style: 'currency', currency }).format(minor / 100);
function useRoomStream(id: string, version: number, ready: boolean, generation: number) {
  const client = useQueryClient(),
    [connection, setConnection] = useState('disconnected');
  const [reconnect, setReconnect] = useState(0);
  useEffect(() => {
    if (!ready || !id) {
      setConnection('disconnected');
      return;
    }
    const queryKey = ['room', id, generation];
    const actor = createActor(connectionMachine).start();
    const subscription = actor.subscribe((s) => setConnection(String(s.value)));
    actor.send({ type: 'CONNECT' });
    const source = new EventSource(
      `/app/api/blueprints/${encodeURIComponent(id)}/events?since=${version}&connection=${reconnect}`,
    );
    const reload = () => {
      actor.send({ type: 'GAP' });
      void client.invalidateQueries({ queryKey });
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
        void client.invalidateQueries({ queryKey });
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
        const message = raw as MessageEvent<string>;
        const parsed = JSON.parse(message.data) as Partial<RoomEvent>;
        // A private placeholder carries only its position; its SSE name is the type.
        const event = { actor: '', payload: {}, ...parsed, type: message.type } as RoomEvent;
        const current = client.getQueryData<ProjectRoom>(queryKey);
        if (!current) return reload();
        const next = applyEvent(current, event);
        if (next === 'GAP') reload();
        else client.setQueryData(queryKey, next);
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
      'wo.released_claim',
      'wo.reposted',
      'blueprint.closed',
      'secret.added',
      'secret.revoked',
      'yard.private',
    ])
      source.addEventListener(type, listener);
    return () => {
      window.clearInterval(watchdog);
      source.close();
      subscription.unsubscribe();
      actor.stop();
    };
  }, [client, id, version, ready, reconnect, generation]);
  return connection;
}
export function App() {
  const client = useQueryClient();
  const [pane, setPane] = useState<'room' | 'board' | 'intake'>(
    new URLSearchParams(window.location.search).has('intake') ? 'intake' : 'room',
  );
  const [selected, setSelected] = useState(new URLSearchParams(window.location.search).get('project') ?? '');
  const [session, setSession] = useState({ ready: false, generation: 0, switching: false });
  const [role, setRole] = useState<'buyer' | 'builder' | null>(null);
  const [sessionError, setSessionError] = useState('');
  const generation = useRef(0),
    switching = useRef(false);
  const { theme, toggle } = useUI(),
    {
      register,
      handleSubmit,
      formState: { errors },
      setError,
    } = useForm<{ id: string }>({ defaultValues: { id: selected } });
  const room = useQuery({
    queryKey: ['room', selected, session.generation],
    enabled: session.ready && !!selected,
    queryFn: async ({ signal }) =>
      roomChecked(await api(`/blueprints/${encodeURIComponent(selected)}/room`, { signal })),
  });
  const connection = useRoomStream(selected, room.data?.version ?? 0, session.ready && !!room.data, session.generation);
  const choose = async (role: 'buyer' | 'builder') => {
    if (switching.current) return;
    switching.current = true;
    const nextGeneration = ++generation.current;
    setSession({ ready: false, generation: nextGeneration, switching: true });
    setSessionError('');
    setRole(null);
    try {
      await client.cancelQueries({
        predicate: (query) => ['room', 'board', 'plans', 'intakes', 'site-log'].includes(String(query.queryKey[0])),
      });
      for (const key of ['room', 'board', 'plans', 'intakes', 'site-log']) client.removeQueries({ queryKey: [key] });
      const result = await api('/demo/session', { method: 'POST', body: JSON.stringify({ role }) });
      if (
        !z
          .object({ role: z.literal(role), simulated: z.literal(true) })
          .strict()
          .safeParse(result).success
      )
        throw new Error('The simulated operator could not be confirmed. Try again.');
      setRole(role);
      setSession({ ready: true, generation: nextGeneration, switching: false });
    } catch (e) {
      setSession({ ready: false, generation: nextGeneration, switching: false });
      setSessionError((e as Error).message);
    } finally {
      switching.current = false;
    }
  };
  return (
    <div className="app" data-theme={theme}>
      <a className="skip" href="#main">
        Skip to project
      </a>
      <header className="masthead">
        <a href="../">
          <img src={logo} alt="Yard" width="145" height="40" />
        </a>
        <nav aria-label="Product navigation">
          <a href="../../">Stood ↗</a>
          <a href="../">Yard story</a>
          <button type="button" aria-pressed={pane === 'intake'} onClick={() => setPane('intake')}>
            Describe a project
          </button>
          <button type="button" aria-pressed={pane === 'board'} onClick={() => setPane('board')}>
            The Board
          </button>
          <button type="button" aria-pressed={pane === 'room'} onClick={() => setPane('room')}>
            Project room
          </button>
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
              <button type="button" disabled={session.switching} onClick={() => void choose('buyer')}>
                Buyer
              </button>
              <button type="button" disabled={session.switching} onClick={() => void choose('builder')}>
                Builder
              </button>
            </fieldset>
            <p className="fine">Synthetic accounts only. Operator keys stay on the server.</p>
            {session.switching && <p role="status">Switching simulated operator…</p>}
            {sessionError && <p role="alert">{sessionError}</p>}
          </div>
        </div>
        {pane === 'intake' && <IntakePanel key={session.generation} enabled={session.ready && role === 'buyer'} />}
        {pane === 'board' && (
          <BoardPanel
            key={session.generation}
            generation={session.generation}
            enabled={session.ready}
            onOpen={(id) => {
              if (session.generation !== generation.current) return;
              void client.invalidateQueries({ queryKey: ['room', id] });
              setSelected(id);
              setPane('room');
              window.history.replaceState(null, '', `?project=${encodeURIComponent(id)}`);
            }}
          />
        )}
        {pane === 'room' && (
          <>
            <form
              className="room-picker"
              onSubmit={handleSubmit(({ id }) => {
                if (!projectId.safeParse(id).success) {
                  setError('id', { message: 'Use the project ID from the Board.' });
                  return;
                }
                setSelected(id);
                void client.invalidateQueries({ queryKey: ['room', id, session.generation] });
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
            {session.ready && room.data && (
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
                              <img
                                className="stamp"
                                src={releasedStamp}
                                alt="Stood / Released"
                                width="160"
                                height="56"
                              />
                              <p>
                                Simulated capture confirmed. {money(o.budgetMinor, room.data.currency)} recorded as
                                paid.
                              </p>
                            </div>
                          ) : o.state === 'REWORK' || o.state === 'REFUSED' ? (
                            <div className="stood-verdict refused">
                              <img className="stamp" src={refusedStamp} alt="Stood / Refused" width="160" height="56" />
                              <p>
                                {o.state === 'REWORK'
                                  ? `Not yet. Back to the builder for attempt ${o.attempt ?? 2}. Nothing was paid.`
                                  : 'Refused with no attempts left. Nothing was paid.'}
                              </p>
                              {o.punchList && (
                                <section className="punch-list" aria-label="Punch list from Stood">
                                  <h4>
                                    <span className="state-chip punch">PUNCH LIST</span>
                                  </h4>
                                  <ul>
                                    {o.punchList.map((item) => (
                                      <li key={item.field}>
                                        <code>{item.field}</code> {item.reason}
                                      </li>
                                    ))}
                                  </ul>
                                </section>
                              )}
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
                          <SiteLogPanel
                            key={session.generation}
                            projectId={room.data.id}
                            workOrderId={o.id}
                            generation={session.generation}
                          />
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
                  <HandoverPanel room={room.data} buyer={role === 'buyer'} />
                  <aside className="truth-panel">
                    <p className="eyebrow">Yard builds. Stood pays.</p>
                    <h3>
                      A pass is a finding.
                      <br />
                      Payment needs proof.
                    </h3>
                    <p>
                      Money states arrive from Stood’s matched settlement record. A builder can submit work, never mark
                      it paid.
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
          </>
        )}
      </main>
      <footer>
        Yard builds. Stood pays. <a href="../">Back to the Yard →</a>
      </footer>
    </div>
  );
}
