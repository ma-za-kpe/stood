import { completeIntakeChecked, intakeDraftSchema } from '@stood/yard-contracts';
import type { CostLine } from '@stood/yard-domain';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { assign, createActor, createMachine } from 'xstate';
import { z } from 'zod';
import { BlueprintEditor } from './BlueprintEditor.js';
import type { EditableDraft } from './blueprint-edit.js';
import { CostBreakdown } from './CostBreakdown.js';
import { browserRequestKey } from './claim-keys.js';
import { ApiError, api } from './http.js';
import { foremanChoices, formDraft, formFields, formValues, type IntakeValues, stepNames } from './intake-form.js';

const recordSchema = z.object({
  id: z.string(),
  owner: z.string(),
  version: z.number().int().positive(),
  step: z.number().int().min(0).max(7),
  draft: intakeDraftSchema,
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
type Record = z.infer<typeof recordSchema>;
const planSchema = z.object({
  status: z.enum(['BUYER_REVIEW', 'READY_FOR_BASELINE', 'REVISION_REQUESTED']),
  version: z.number().int().positive(),
  simulated: z.boolean(),
  intakeContext: z.string(),
  blueprint: z.object({
    id: z.string(),
    summary: z.string(),
    currency: z.string(),
    capMinor: z.number().int(),
    milestones: z.array(
      z.object({ id: z.string(), name: z.string(), budgetMinor: z.number().int(), deadline: z.number().int() }),
    ),
    costLines: z.array(z.custom<CostLine>()).optional(),
  }),
  tests: z.array(z.object({ milestoneId: z.string(), id: z.string(), path: z.string(), content: z.string() })),
  requirements: z.array(z.object({ id: z.string(), text: z.string(), testIds: z.array(z.string()) })),
  risks: z.array(z.string()),
});
type Plan = z.infer<typeof planSchema>;
const wizard = createMachine({
  context: { step: 0 },
  initial: 'editing',
  states: {
    editing: {
      on: {
        NEXT: { actions: assign({ step: ({ context }) => Math.min(7, context.step + 1) }) },
        BACK: { actions: assign({ step: ({ context }) => Math.max(0, context.step - 1) }) },
        SUMMARY: 'summary',
        RESTORE: { actions: assign({ step: ({ event }) => event.step }) },
      },
    },
    summary: { on: { EDIT: 'editing', PLAN: 'planning' } },
    planning: { on: { DONE: 'review', ERROR: 'summary' } },
    review: { on: { EDIT: 'editing' } },
  },
  types: {} as {
    events:
      | { type: 'NEXT' | 'BACK' | 'SUMMARY' | 'EDIT' | 'PLAN' | 'DONE' | 'ERROR' }
      | { type: 'RESTORE'; step: number };
  },
});
const encoded = (values: IntakeValues) =>
  Object.fromEntries(Object.entries(values).map(([k, v]) => [k.replace('.', '__'), v]));
const decoded = (values: IntakeValues) =>
  Object.fromEntries(Object.entries(values).map(([k, v]) => [k.replace('__', '.'), v]));
export function IntakePanel({ enabled }: { enabled: boolean }) {
  const actorRef = useRef<ReturnType<typeof createActor<typeof wizard>> | null>(null);
  const [state, setState] = useState({ view: 'editing', step: 0 });
  const [record, setRecord] = useState<Record | null>(null),
    recordRef = useRef<Record | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [status, setStatus] = useState('');
  const [revision, setRevision] = useState(0),
    [plan, setPlan] = useState<Plan | null>(null);
  const [editingPlan, setEditingPlan] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null),
    returnToReview = useRef(false);
  useEffect(() => {
    if (!editingPlan && returnToReview.current && editButton.current) {
      returnToReview.current = false;
      editButton.current.focus();
    }
  }, [editingPlan]);
  const [resumeId, setResumeId] = useState(new URLSearchParams(window.location.search).get('intake') ?? '');
  const { register, getValues, reset, setValue, watch } = useForm<IntakeValues>();
  const controller = useRef<AbortController | null>(null),
    saved = useRef(''),
    pending = useRef(false);
  const retryWrite = useRef<{ id: string; version: number; key: string; body: string; values: IntakeValues } | null>(
      null,
    ),
    createId = useRef<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const [externalStale, setExternalStale] = useState(false),
    [feed, setFeed] = useState('disconnected');
  const live = useRef(true),
    failedRevision = useRef(-1);
  useEffect(() => {
    live.current = true;
    controller.current = new AbortController();
    const actor = createActor(wizard).start();
    actorRef.current = actor;
    const subscription = actor.subscribe((s) => setState({ view: String(s.value), step: s.context.step }));
    return () => {
      live.current = false;
      controller.current?.abort();
      subscription.unsubscribe();
      actor.stop();
    };
  }, []);
  useEffect(() => {
    const subscription = watch(() => setRevision((v) => v + 1));
    return () => subscription.unsubscribe();
  }, [watch]);
  useEffect(() => {
    if (!enabled || !record) return;
    const source = new EventSource(`/app/api/intakes/${encodeURIComponent(record.id)}/events?since=${record.version}`);
    source.onopen = () => setFeed('connected');
    source.onerror = () => setFeed('disconnected');
    const stale = () => {
      setExternalStale(true);
      setError('These answers changed in another tab. Reload the saved version before continuing.');
    };
    source.addEventListener('snapshot.required', stale);
    source.addEventListener('intake.saved', (raw) => {
      try {
        const event = z
          .object({ seq: z.number().int().positive() })
          .parse(JSON.parse((raw as MessageEvent<string>).data));
        if (!pending.current && !retryWrite.current && event.seq > (recordRef.current?.version ?? 0)) stale();
      } catch {
        stale();
      }
    });
    return () => source.close();
  }, [enabled, record]);
  const request = useCallback(
    (path: string, options?: RequestInit) => api(path, { ...options, signal: controller.current?.signal ?? null }),
    [],
  );
  const install = (value: unknown) => {
    const next = recordSchema.parse(value);
    if (!live.current) return;
    recordRef.current = next;
    setExternalStale(false);
    setPlan(null);
    setEditingPlan(false);
    actorRef.current?.send({ type: 'EDIT' });
    retryWrite.current = null;
    setRecord(next);
    setResumeId(next.id);
    const values = encoded(formValues(next.draft));
    saved.current = JSON.stringify(values);
    reset(values);
    actorRef.current?.send({ type: 'RESTORE', step: next.step });
    window.history.replaceState(null, '', `?intake=${encodeURIComponent(next.id)}`);
  };
  const open = async (create: boolean) => {
    if (pending.current || !enabled) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      if (create && !createId.current) createId.current = `idea-${browserRequestKey()}`;
      const id = create ? (createId.current ?? '') : resumeId;
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new Error('Enter the intake ID from your saved link.');
      install(
        await request(
          create ? '/intakes' : `/intakes/${encodeURIComponent(id)}`,
          create
            ? {
                method: 'POST',
                headers: { 'If-Match': '0', 'Idempotency-Key': id },
                body: JSON.stringify({ id, step: 0, draft: {} }),
              }
            : undefined,
        ),
      );
      if (live.current) {
        if (create && recordRef.current)
          setValue(
            'timing__deadline',
            new Date(recordRef.current.createdAt + 21 * 86400000).toISOString().slice(0, 16),
            { shouldDirty: true },
          );
        setStatus('Saved privately. Only this buyer can resume these answers.');
      }
    } catch (e) {
      if (live.current) setError((e as Error).message);
    } finally {
      pending.current = false;
      if (live.current) setBusy(false);
    }
  };
  const save = useCallback(async () => {
    const current = recordRef.current;
    if (!current || pending.current || !enabled || externalStale) return false;
    const values = getValues();
    if (JSON.stringify(values) === saved.current && state.step === current.step) return true;
    pending.current = true;
    setBusy(true);
    setError('');
    setStatus('Saving…');
    try {
      if (!retryWrite.current) {
        const draft = formDraft(decoded(values));
        retryWrite.current = {
          id: current.id,
          version: current.version,
          key: browserRequestKey(),
          body: JSON.stringify({ step: state.step, draft }),
          values: structuredClone(values),
        };
      }
      const command = retryWrite.current;
      const next = recordSchema.parse(
        await request(`/intakes/${command.id}`, {
          method: 'PUT',
          headers: { 'If-Match': String(command.version), 'Idempotency-Key': command.key },
          body: command.body,
        }),
      );
      if (!live.current) return false;
      recordRef.current = next;
      setRecord(next);
      saved.current = JSON.stringify(command.values);
      retryWrite.current = null;
      failedRevision.current = -1;
      setStatus('Saved privately.');
      return JSON.stringify(getValues()) === saved.current && state.step === next.step;
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) retryWrite.current = null;
      failedRevision.current = revision;
      if (live.current) {
        setError((e as Error).message);
        setStatus('Changes are not saved. Correct the answers or reload the saved version.');
      }
      return false;
    } finally {
      pending.current = false;
      if (live.current) setBusy(false);
    }
  }, [enabled, externalStale, getValues, request, revision, state.step]);
  // One write in flight. A changed answer during a save is picked up on completion;
  // a stale or failed write never marks those newer answers as saved.
  useEffect(() => {
    if (!record || busy || !enabled || state.view !== 'editing' || externalStale || failedRevision.current === revision)
      return;
    if (JSON.stringify(getValues()) === saved.current && state.step === record.step) return;
    const timer = window.setTimeout(() => void save(), 800);
    return () => window.clearTimeout(timer);
  }, [revision, busy, enabled, externalStale, record, state.step, state.view, getValues, save]);
  const summary = async () => {
    if (!(await save())) return;
    try {
      const current = recordRef.current;
      if (!current) return;
      const draft = formDraft(decoded(getValues()));
      completeIntakeChecked(
        { ...draft, handover: { ...draft.handover, baseCommit: '0'.repeat(40) } },
        current.updatedAt,
      );
      actorRef.current?.send({ type: 'SUMMARY' });
      setError('');
    } catch (e) {
      setError(
        (e as Error).message === 'INVALID_INTAKE'
          ? 'Complete the idea, budget, deadline, sign-off and ownership choices before reviewing.'
          : (e as Error).message,
      );
    }
  };
  const planWork = async () => {
    const current = recordRef.current;
    if (!current || pending.current || externalStale) return;
    pending.current = true;
    setBusy(true);
    setError('');
    actorRef.current?.send({ type: 'PLAN' });
    try {
      const next = planSchema.parse(
        await request(`/intakes/${current.id}/plan`, {
          method: 'POST',
          headers: { 'If-Match': String(current.version), 'Idempotency-Key': `plan-${current.version}` },
          body: '{}',
        }),
      );
      if (live.current) {
        setPlan(next);
        actorRef.current?.send({ type: 'DONE' });
      }
    } catch (e) {
      if (live.current) {
        setError((e as Error).message);
        actorRef.current?.send({ type: 'ERROR' });
      }
    } finally {
      pending.current = false;
      if (live.current) setBusy(false);
    }
  };
  const saveEditedPlan = async (draft: EditableDraft, key: string) => {
    if (!plan || pending.current || externalStale) throw new Error('Review unavailable');
    pending.current = true;
    setBusy(true);
    try {
      const next = planSchema.parse(
        await request(`/plans/${plan.blueprint.id}/edits`, {
          method: 'POST',
          headers: { 'If-Match': String(plan.version), 'Idempotency-Key': key },
          body: JSON.stringify(draft),
        }),
      );
      if (live.current) {
        setPlan(next);
        returnToReview.current = true;
        setEditingPlan(false);
        setStatus(`Review version ${next.version} saved. Read the tests before approving.`);
      }
    } finally {
      pending.current = false;
      if (live.current) setBusy(false);
    }
  };
  const reloadEditedPlan = async () => {
    if (!plan || pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      const next = planSchema.parse(await request(`/plans/${plan.blueprint.id}`));
      if (live.current) {
        setPlan(next);
        returnToReview.current = true;
        setEditingPlan(false);
        setStatus(`Review version ${next.version} saved. Read the tests before approving.`);
      }
    } catch {
      if (live.current) setError('Could not reload the saved draft.');
    } finally {
      pending.current = false;
      if (live.current) setBusy(false);
    }
  };
  const review = async (decision: 'ACCEPT' | 'REVISE') => {
    if (!plan || pending.current || externalStale) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const next = planSchema.parse(
        await request(`/plans/${plan.blueprint.id}/review`, {
          method: 'POST',
          headers: { 'If-Match': String(plan.version), 'Idempotency-Key': browserRequestKey() },
          body: JSON.stringify({ decision }),
        }),
      );
      if (live.current) setPlan(next);
    } catch (e) {
      if (live.current) setError((e as Error).message);
    } finally {
      pending.current = false;
      if (live.current) setBusy(false);
    }
  };
  const revise = async () => {
    if (!plan || pending.current || externalStale || !feedback.trim()) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      // The same intake scanner runs before sending feedback to the model.
      formDraft({ 'idea.description': feedback });
      const next = planSchema.parse(
        await request(`/plans/${plan.blueprint.id}/revisions`, {
          method: 'POST',
          headers: { 'If-Match': String(plan.version), 'Idempotency-Key': browserRequestKey() },
          body: JSON.stringify({ feedback }),
        }),
      );
      if (live.current) {
        setPlan(next);
        setFeedback('');
      }
    } catch (e) {
      if (live.current) setError((e as Error).message);
    } finally {
      pending.current = false;
      if (live.current) setBusy(false);
    }
  };
  if (!enabled)
    return (
      <section className="intake-panel">
        <h2>Describe it. Build it.</h2>
        <p>Choose the simulated buyer to start or resume a private intake.</p>
      </section>
    );
  return (
    <section className="intake-panel" aria-labelledby="intake-title">
      <p className="eyebrow">Yard / the Foreman</p>
      <h2 id="intake-title">Your idea. A clear blueprint.</h2>
      <p>
        Choices first, keys later. The pilot is free; a future platform fee will be shown before agreement. This demo
        plans with a scripted model. It never executes a payment.
      </p>
      {error && (
        <p role="alert">
          {error === 'CREDENTIAL_IN_INTAKE'
            ? 'That looks like a key. Remove it before saving. Credential intake is not enabled.'
            : error}
        </p>
      )}
      <p role="status">{busy ? 'Working…' : status}</p>
      {!record ? (
        <div className="intake-start">
          <button type="button" disabled={busy} onClick={() => void open(true)}>
            Start a private intake
          </button>
          <label htmlFor="resume-intake">Resume intake ID</label>
          <input id="resume-intake" value={resumeId} onChange={(e) => setResumeId(e.target.value)} />
          <button type="button" disabled={busy} onClick={() => void open(false)}>
            Resume saved intake
          </button>
        </div>
      ) : (
        <>
          <p className="fine">
            Saved link: <a href={`?intake=${record.id}`}>{record.id}</a> · version {record.version}. Answers are stored
            on the service, never in browser storage.
          </p>
          <p className="fine">
            Intake updates: {feed === 'connected' ? 'connected' : 'disconnected; showing the last saved version'}.
          </p>
          <button type="button" disabled={busy} onClick={() => void open(false)}>
            Reload saved version
          </button>
          {state.view === 'editing' && (
            <>
              <ol className="intake-rail" aria-label="Intake progress">
                {stepNames.map((name, i) => (
                  <li key={name} aria-current={state.step === i ? 'step' : undefined}>
                    <span>{i + 1}</span> {name}
                  </li>
                ))}
              </ol>
              <h3>
                {state.step + 1}. {stepNames[state.step]}
              </h3>
              <p className="fine">
                Why we ask appears beside each field. Your answers are private to you and the planning service; the
                planning model receives these choices. Never paste credentials.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void summary();
                }}
              >
                <fieldset disabled={busy}>
                  <legend className="sr-only">{stepNames[state.step]}</legend>
                  {(formFields[state.step] ?? []).map((item) => {
                    const name = item.path.replace('.', '__'),
                      id = `intake-${name}`;
                    return (
                      <div className="intake-field" key={item.path}>
                        <label htmlFor={id}>{item.label}</label>
                        <p id={`${id}-why`} className="fine">
                          {item.why}
                        </p>
                        {item.choices || item.kind === 'boolean' ? (
                          <select id={id} aria-describedby={`${id}-why`} {...register(name)}>
                            <option value="">Choose…</option>
                            {(item.choices ?? ['true', 'false']).map((value) => (
                              <option key={value} value={value}>
                                {value === 'FOREMAN'
                                  ? 'Let the Foreman decide'
                                  : value === 'true'
                                    ? 'Yes'
                                    : value === 'false'
                                      ? 'No'
                                      : value.replaceAll('_', ' ').toLowerCase()}
                              </option>
                            ))}
                          </select>
                        ) : ['list', 'services', 'long'].includes(item.kind ?? '') ? (
                          <textarea
                            id={id}
                            rows={item.kind === 'long' ? 5 : 3}
                            aria-describedby={`${id}-why`}
                            {...register(name)}
                          />
                        ) : (
                          <input
                            id={id}
                            type={
                              item.kind === 'date' ? 'datetime-local' : item.path.endsWith('Email') ? 'email' : 'text'
                            }
                            inputMode={item.kind === 'money' ? 'decimal' : undefined}
                            aria-describedby={`${id}-why`}
                            {...register(name)}
                          />
                        )}
                      </div>
                    );
                  })}
                </fieldset>
                <div className="intake-actions">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      for (const [key, value] of Object.entries(foremanChoices(state.step)))
                        setValue(key.replace('.', '__'), value, { shouldDirty: true });
                    }}
                  >
                    Let the Foreman decide
                  </button>
                  <button
                    type="button"
                    disabled={busy || state.step === 0}
                    onClick={() => actorRef.current?.send({ type: 'BACK' })}
                  >
                    Back
                  </button>
                  {state.step < 7 ? (
                    <button type="button" disabled={busy} onClick={() => actorRef.current?.send({ type: 'NEXT' })}>
                      Next step
                    </button>
                  ) : (
                    <button type="submit" disabled={busy}>
                      Review my choices
                    </button>
                  )}
                  <button type="button" disabled={busy} onClick={() => void save()}>
                    Save now
                  </button>
                </div>
              </form>
            </>
          )}
          {(state.view === 'summary' || state.view === 'planning') && (
            <>
              <h3>Read your choices.</h3>
              <p>Nothing is signed. The Foreman will propose tests and milestones within this budget and deadline.</p>
              {stepNames.map((name, i) => (
                <details key={name} open>
                  <summary>{name}</summary>
                  <dl>
                    {(formFields[i] ?? []).map((field) => (
                      <div key={field.path}>
                        <dt>{field.label}</dt>
                        <dd>{decoded(getValues())[field.path] || 'None'}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              ))}
              <button type="button" disabled={busy} onClick={() => actorRef.current?.send({ type: 'EDIT' })}>
                Edit choices
              </button>
              <button type="button" disabled={busy} onClick={() => void planWork()}>
                Ask the Foreman for a blueprint
              </button>
            </>
          )}
          {state.view === 'review' && plan && (
            <>
              <p className="signal">{plan.simulated ? 'SIMULATED PLANNER' : 'PLANNER DRAFT'}</p>
              <h3>Blueprint’s ready. Read the tests.</h3>
              <p>{plan.blueprint.summary}</p>
              <p className="fine">Review version {plan.version} · unsigned blueprint.</p>
              <p>No signing or funding yet. Accepting this draft sends it to the baseline gate.</p>
              {plan.blueprint.milestones.map((m) => (
                <article className="intake-milestone" key={m.id}>
                  <h4>
                    {m.name} ·{' '}
                    {new Intl.NumberFormat('en', { style: 'currency', currency: plan.blueprint.currency }).format(
                      m.budgetMinor / 100,
                    )}
                  </h4>
                  <p>Due {new Date(m.deadline).toISOString()}</p>
                  {plan.tests
                    .filter((t) => t.milestoneId === m.id)
                    .map((t) => (
                      <details key={t.id}>
                        <summary>{t.path}</summary>
                        <pre>{t.content}</pre>
                      </details>
                    ))}
                </article>
              ))}
              <CostBreakdown blueprint={plan.blueprint} />
              {plan.status === 'REVISION_REQUESTED' && (
                <div className="intake-field">
                  <label htmlFor="plan-feedback">What should change?</label>
                  <textarea
                    id="plan-feedback"
                    value={feedback}
                    disabled={busy}
                    onChange={(e) => setFeedback(e.target.value)}
                  />
                  <button type="button" disabled={busy || !feedback.trim()} onClick={() => void revise()}>
                    Revise the blueprint
                  </button>
                </div>
              )}
              <ul>
                {plan.risks.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              {plan.status === 'BUYER_REVIEW' && editingPlan ? (
                <BlueprintEditor
                  key={`${plan.blueprint.id}:${plan.version}`}
                  initial={{
                    summary: plan.blueprint.summary,
                    requirements: plan.requirements,
                    risks: plan.risks,
                    milestones: plan.blueprint.milestones.map((m) => ({
                      ...m,
                      tests: plan.tests
                        .filter((t) => t.milestoneId === m.id)
                        .map(({ id, path, content }) => ({ id, path, content })),
                    })),
                  }}
                  currency={plan.blueprint.currency}
                  capMinor={plan.blueprint.capMinor}
                  busy={busy}
                  save={saveEditedPlan}
                  close={() => {
                    returnToReview.current = true;
                    setEditingPlan(false);
                  }}
                  reload={reloadEditedPlan}
                />
              ) : plan.status === 'BUYER_REVIEW' ? (
                <>
                  <button ref={editButton} type="button" disabled={busy} onClick={() => setEditingPlan(true)}>
                    Edit blueprint
                  </button>
                  <button type="button" disabled={busy} onClick={() => void review('ACCEPT')}>
                    Accept draft for baseline checks
                  </button>
                  <button type="button" disabled={busy} onClick={() => void review('REVISE')}>
                    Request a revision
                  </button>
                </>
              ) : (
                <p role="status">
                  {plan.status === 'READY_FOR_BASELINE'
                    ? 'Draft accepted. Baseline checks are required before signing.'
                    : 'Revision requested. No work order or payment was created.'}
                </p>
              )}
            </>
          )}
          <p className="fine">
            Simulation date: {new Date(record.updatedAt).toLocaleDateString('en', { timeZone: 'UTC' })}. Step 9 —
            test-key connection — is disabled. Real keys belong in your own hosting at handover.
          </p>
        </>
      )}
    </section>
  );
}
