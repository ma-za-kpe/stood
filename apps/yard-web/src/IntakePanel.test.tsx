// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { api, render, streams } from '../test/harness.js';
import { completeDraft, intakeServer, plan, progress } from '../test/intake-server.js';
import { IntakePanel } from './IntakePanel.js';

afterEach(() => window.history.replaceState(null, '', '/'));
const click = async (name: string | RegExp) => {
  await act(async () => fireEvent.click(screen.getByRole('button', { name })));
};
const saved = () =>
  waitFor(
    () => expect(screen.getAllByRole('status').some((s) => /Saved privately/.test(s.textContent ?? ''))).toBe(true),
    { timeout: 3000 },
  );

describe('IntakePanel (T-0275)', () => {
  it('asks people to sign in as a buyer first', () => {
    render(<IntakePanel enabled={false} />);
    expect(screen.getByText('Sign in as a buyer to start or resume a private intake.')).toBeTruthy();
  });

  it('starts a private intake, autosaves with version checks, and moves between sections', async () => {
    streams();
    const server = intakeServer();
    const calls = api(server.reply);
    render(<IntakePanel enabled />);
    expect(screen.getByText(/local run uses a scripted planner/)).toBeTruthy();
    // A second press while the first create is running is ignored.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start a private intake' }));
      fireEvent.click(screen.getByRole('button', { name: 'Start a private intake' }));
    });
    await saved();
    expect(calls.filter((c) => c.method === 'POST' && c.path === '/intakes')).toHaveLength(1);
    const create = calls.find((c) => c.method === 'POST' && c.path === '/intakes');
    expect(create?.headers.get('If-Match')).toBe('0');
    expect(window.location.search).toMatch(/^\?intake=idea-/);
    expect(screen.getByText('1. The idea')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('What are we building?'), { target: { value: 'A salon booking app' } });
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true), { timeout: 3000 });
    await saved();
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.headers.get('If-Match')).toBe('1');
    expect(JSON.parse(put?.body ?? '').draft.idea.description).toBe('A salon booking app');
    await click('Next step');
    expect(screen.getByText('2. People and places')).toBeTruthy();
    await click('Let the Foreman decide');
    await click('Back');
    expect(screen.getByText('1. The idea')).toBeTruthy();
    await click(/7 Budget and timing/);
    expect(screen.getByText('7. Budget and timing')).toBeTruthy();
    await click('Save now');
    await saved();
    expect(screen.getByText(/Intake updates: disconnected/)).toBeTruthy();
  });

  it('explains what is missing before review, then plans, edits, accepts and revises a blueprint', async () => {
    streams();
    const server = intakeServer({ draft: completeDraft(), step: 7 });
    const calls = api(server.reply);
    render(<IntakePanel enabled />);
    await click('Start a private intake');
    await saved();
    expect(screen.getByText('8. Ownership and handover')).toBeTruthy();
    await click('Review my choices');
    await waitFor(() => expect(screen.getByText('Review your project brief.')).toBeTruthy());
    expect(screen.getByLabelText('Saved what are we building?')).toBeTruthy();
    server.state.failPlan = true;
    await click('Ask the Foreman for a blueprint');
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not complete/);
    server.state.failPlan = false;
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Ask the Foreman for a blueprint' }));
      fireEvent.click(screen.getByRole('button', { name: 'Ask the Foreman for a blueprint' }));
    });
    expect(calls.filter((c) => c.path.endsWith('/plan'))).toHaveLength(2);
    expect(await screen.findByText('Blueprint’s ready. Read the tests.')).toBeTruthy();
    expect(screen.getByText('SIMULATED PLANNER')).toBeTruthy();
    expect(screen.getByText('Payments are simulated until qualified')).toBeTruthy();
    await click('Edit blueprint');
    fireEvent.change(screen.getByLabelText('Project summary'), { target: { value: 'An edited booking app' } });
    await click('Save draft for fresh review');
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Review version 2 saved/));
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Edit blueprint'));
    await click('Edit blueprint');
    await click('Discard edits');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Request a revision' }));
      fireEvent.click(screen.getByRole('button', { name: 'Request a revision' }));
    });
    expect(await screen.findByText('Revision requested. No work order or payment was created.')).toBeTruthy();
    expect(calls.filter((c) => c.path === '/plans/bp1/review')).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('What should change?'), { target: { value: 'Add reminders by text' } });
    await click('Revise the blueprint');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Accept draft for baseline checks' })).toBeTruthy());
    await click('Accept draft for baseline checks');
    expect(await screen.findByText('Draft accepted. Baseline checks are required before signing.')).toBeTruthy();
    expect(calls.filter((c) => c.path === '/plans/bp1/review').map((c) => JSON.parse(c.body).decision)).toEqual([
      'REVISE',
      'ACCEPT',
    ]);
  });

  // C4 (#77): after accepting, the buyer freezes the tests and Stood shows them failing on the base commit.
  const accepted = async () => {
    streams();
    const server = intakeServer({ draft: completeDraft(), step: 7 });
    const calls = api(server.reply);
    render(<IntakePanel enabled />);
    await click('Start a private intake');
    await saved();
    await click('Review my choices');
    await click('Ask the Foreman for a blueprint');
    await click('Accept draft for baseline checks');
    expect(await screen.findByText('Draft accepted. Baseline checks are required before signing.')).toBeTruthy();
    return { server, calls };
  };

  it('freezes the accepted tests once Stood shows every one failing on the base commit', async () => {
    const { server, calls } = await accepted();
    server.state.baselines = [
      progress('BASELINE_RUNNING', [{ baseline: 'DONE' }, { baseline: 'QUEUED' }, { baseline: 'QUEUED' }]),
      progress('FROZEN', [{ baseline: 'DONE' }, { baseline: 'DONE' }, { baseline: 'DONE' }]),
    ];
    // A double click sends one request.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Freeze the tests and run the baseline' }));
      fireEvent.click(screen.getByRole('button', { name: 'Freeze the tests and run the baseline' }));
    });
    expect(
      await screen.findByText('Stood is running the accepted tests on commit c0ffee0: 1 of 3 milestones checked.'),
    ).toBeTruthy();
    await click('Check progress');
    expect(
      await screen.findByText(
        'Blueprint frozen at commit c0ffee0. Every accepted test failed there, as it should before any work.',
      ),
    ).toBeTruthy();
    expect(calls.filter((c) => c.path === '/plans/bp1/blueprint').map((c) => c.body)).toEqual(['{}', '{}']);
  });

  it('names the tests that cannot prove new work, and reports an unavailable service', async () => {
    const { server } = await accepted();
    await click('Freeze the tests and run the baseline');
    expect(await screen.findByRole('alert')).toBeTruthy();
    server.state.baselines = [
      progress('NEEDS_REVISION', [{ baseline: 'DONE', passing: ['a'] }, { baseline: 'INVALID' }, { baseline: 'DONE' }]),
    ];
    await click('Freeze the tests and run the baseline');
    expect(await screen.findByText('These tests cannot prove new work, so the blueprint was not frozen:')).toBeTruthy();
    expect(screen.getByText('m1: already passing (a)')).toBeTruthy();
    expect(screen.getByText('m2: the tests are not at the base commit as accepted')).toBeTruthy();
    expect(screen.queryByText(/^m3:/)).toBeNull();
  });

  it('refuses an incomplete local brief, a bad saved link and a pasted credential', async () => {
    streams();
    const server = intakeServer({ step: 7 });
    api(server.reply);
    render(<IntakePanel enabled />);
    fireEvent.change(screen.getByLabelText('Resume intake ID'), { target: { value: 'not a valid id!' } });
    await click('Resume saved intake');
    expect(screen.getByRole('alert').textContent).toBe('Enter the intake ID from your saved link.');
    await click('Start a private intake');
    await saved();
    await click('Review my choices');
    expect((await screen.findByRole('alert')).textContent).toMatch(/Complete the idea, budget, deadline/);
    await click(/1 The idea/);
    fireEvent.change(screen.getByLabelText('What are we building?'), {
      target: { value: 'key sk_test_do_not_save_this' },
    });
    await click('Save now');
    expect((await screen.findByRole('alert')).textContent).toMatch(/looks like a key/);
  });

  it('opens a saved hosted link as a brief overview, allows partial briefs and explains planning is next', async () => {
    const all = streams();
    const server = intakeServer();
    const calls = api(server.reply);
    // Create the record the saved link points at.
    const seed = render(<IntakePanel enabled hosted />);
    await click('Start a private intake');
    await saved();
    const id = new URLSearchParams(window.location.search).get('intake') ?? '';
    seed.unmount();
    window.history.replaceState(null, '', `?intake=${id}`);
    render(<IntakePanel enabled hosted />);
    expect(await screen.findByText('Review your project brief.')).toBeTruthy();
    expect(calls.filter((c) => c.method === 'GET' && c.path === `/intakes/${id}`).length).toBe(1);
    expect(screen.getByText(/Planning is the next connection/)).toBeTruthy();
    expect(screen.getByText(/Planning is coming next; nothing is signed or funded/)).toBeTruthy();
    expect(screen.getAllByText('Not chosen yet').length).toBeGreaterThan(5);
    act(() => all.at(-1)?.open());
    expect(screen.getByText(/Intake updates: connected/)).toBeTruthy();
    await click('Edit choices');
    expect(screen.getByText('1. The idea')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('What are we building?'), { target: { value: 'Partial idea only' } });
    await click('Review my brief');
    expect(await screen.findByText('Review your project brief.')).toBeTruthy();
    expect((screen.getByLabelText('Saved what are we building?') as HTMLTextAreaElement).value).toBe(
      'Partial idea only',
    );
  });

  it('stops saving when another tab changed the answers, until the saved version is reloaded', async () => {
    const all = streams();
    const server = intakeServer();
    const calls = api(server.reply);
    render(<IntakePanel enabled />);
    await click('Start a private intake');
    await saved();
    const stream = all.at(-1);
    act(() => stream?.send('intake.saved', { seq: 1 }));
    expect(screen.queryByRole('alert')).toBeNull();
    act(() => stream?.send('intake.saved', { seq: 7 }));
    expect(screen.getByRole('alert').textContent).toMatch(/changed in another tab/);
    const puts = calls.filter((c) => c.method === 'PUT').length;
    fireEvent.change(screen.getByLabelText('What are we building?'), { target: { value: 'Ignored while stale' } });
    await click('Save now');
    expect(calls.filter((c) => c.method === 'PUT').length).toBe(puts);
    await click('Reload saved version');
    await saved();
    expect(screen.queryByRole('alert')).toBeNull();
    act(() => all.at(-1)?.send('intake.saved', 'not json'));
    expect(screen.getByRole('alert').textContent).toMatch(/changed in another tab/);
    await click('Reload saved version');
    act(() => all.at(-1)?.send('snapshot.required'));
    expect(screen.getByRole('alert').textContent).toMatch(/changed in another tab/);
    act(() => all.at(-1)?.fail());
    expect(screen.getByText(/Intake updates: disconnected/)).toBeTruthy();
  });

  it('retries a lost save with the same key, starts afresh after a refusal, and never marks it saved', async () => {
    streams();
    const server = intakeServer();
    const calls = api(server.reply);
    render(<IntakePanel enabled />);
    await click('Start a private intake');
    await saved();
    server.state.failPut = 503;
    fireEvent.change(screen.getByLabelText('What are we building?'), { target: { value: 'First answer' } });
    await click('Save now');
    expect(screen.getByRole('status').textContent).toMatch(/Changes are not saved/);
    await click('Save now');
    const keys = calls.filter((c) => c.method === 'PUT').map((c) => c.headers.get('Idempotency-Key'));
    expect(keys.length).toBe(2);
    expect(keys[1]).toBe(keys[0]);
    server.state.failPut = 422;
    await click('Save now');
    await click('Save now');
    const after = calls.filter((c) => c.method === 'PUT').map((c) => c.headers.get('Idempotency-Key'));
    expect(after[3]).not.toBe(after[2]);
    server.state.failPut = 0;
    await click('Save now');
    await saved();
    // A failed save also blocks review until it succeeds.
    server.state.failPut = 503;
    fireEvent.change(screen.getByLabelText('What are we building?'), { target: { value: 'Changed again' } });
    await click(/8 Ownership and handover/);
    await click('Review my choices');
    expect(screen.getByRole('status').textContent).toMatch(/Changes are not saved/);
    expect(screen.queryByText('Review your project brief.')).toBeNull();
  });

  it('reports planning, review, revision and reload failures without inventing state', async () => {
    streams();
    const server = intakeServer({ draft: completeDraft(), step: 7 });
    const reply = server.reply;
    let fail = '';
    api((c) => (fail && c.path.startsWith(fail) ? { status: 503 } : reply(c)));
    render(<IntakePanel enabled />);
    await click('Start a private intake');
    await saved();
    await click('Review my choices');
    await click('Ask the Foreman for a blueprint');
    await screen.findByText('Blueprint’s ready. Read the tests.');
    fail = '/plans/bp1/review';
    await click('Request a revision');
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not complete/);
    fail = '';
    await click('Request a revision');
    await screen.findByText('Revision requested. No work order or payment was created.');
    fireEvent.change(screen.getByLabelText('What should change?'), {
      target: { value: 'Use sk_test_do_not_save_this' },
    });
    await click('Revise the blueprint');
    expect(screen.getByRole('alert').textContent).toMatch(/looks like a key/);
    fireEvent.change(screen.getByLabelText('What should change?'), { target: { value: 'Add reminders' } });
    fail = '/plans/bp1/revisions';
    await click('Revise the blueprint');
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not complete/);
    fail = '';
    await click('Revise the blueprint');
    await screen.findByRole('button', { name: 'Edit blueprint' });
    await click('Edit blueprint');
    fail = '/plans/bp1/edits';
    fireEvent.change(screen.getByLabelText('Project summary'), { target: { value: 'Edited' } });
    await click('Save draft for fresh review');
    expect(screen.getByRole('alert').textContent).toMatch(/save is unresolved/);
    fail = '/plans/bp1';
    await click('Reload saved draft');
    expect(
      (await screen.findAllByRole('alert')).some((a) => /Could not reload the saved draft/.test(a.textContent ?? '')),
    ).toBe(true);
    fail = '';
    await click('Reload saved draft');
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Review version \d+ saved/));
  });

  it('starts from an imported idea and shows a real planner draft as such', async () => {
    streams();
    const server = intakeServer({ draft: completeDraft(), step: 7 });
    server.state.plan = { ...plan(), simulated: false };
    const calls = api(server.reply);
    render(<IntakePanel enabled />);
    fireEvent.change(await screen.findByLabelText('Startup Tribunal JSON'), {
      target: {
        value: (await import('node:fs')).readFileSync(
          'packages/yard-contracts/test/fakes/startup-tribunal.json',
          'utf8',
        ),
      },
    });
    await click('Review imported idea');
    await click(/Use this idea in a private intake/);
    await saved();
    expect(
      JSON.parse(calls.find((c) => c.method === 'POST' && c.path === '/intakes')?.body ?? '').draft.idea,
    ).toBeTruthy();
    await click('Review my choices');
    await click('Ask the Foreman for a blueprint');
    expect(await screen.findByText('PLANNER DRAFT')).toBeTruthy();
  });

  // Leaving the page while a request is in flight must not apply its late reply, successful or not.
  for (const outcome of ['success', 'failure'] as const)
    it(`discards a late ${outcome} for every operation after the page is left`, async () => {
      const ops: [string, (c: { method: string; path: string }) => boolean, () => Promise<void>][] = [
        ['create', (c) => c.method === 'POST' && c.path === '/intakes', async () => click('Start a private intake')],
        ['save', (c) => c.method === 'PUT', async () => click('Save now')],
        ['plan', (c) => c.path.endsWith('/plan'), async () => click('Ask the Foreman for a blueprint')],
        ['review', (c) => c.path === '/plans/bp1/review', async () => click('Request a revision')],
        ['edit', (c) => c.path === '/plans/bp1/edits', async () => click('Save draft for fresh review')],
        ['reload', (c) => c.method === 'GET' && c.path === '/plans/bp1', async () => click('Reload saved draft')],
        ['revise', (c) => c.path === '/plans/bp1/revisions', async () => click('Revise the blueprint')],
      ];
      for (const [name, matches, start] of ops) {
        window.history.replaceState(null, '', '/');
        streams();
        const server = intakeServer({ draft: completeDraft(), step: 7 });
        let hold = false;
        let release: () => void = () => undefined;
        api((c) => {
          if (hold && matches(c))
            return new Promise((r) => {
              release = () => r(outcome === 'success' ? server.reply(c) : { status: 503 });
            });
          return server.reply(c);
        });
        const view = render(<IntakePanel enabled />);
        if (name !== 'create') {
          await click('Start a private intake');
          await saved();
          fireEvent.change(screen.getByLabelText('Custom domain'), { target: { value: 'salon.example' } });
        }
        if (['plan', 'review', 'edit', 'reload', 'revise'].includes(name)) {
          await click('Review my choices');
          await screen.findByText('Review your project brief.');
        }
        if (['review', 'edit', 'reload', 'revise'].includes(name)) {
          await click('Ask the Foreman for a blueprint');
          await screen.findByText('Blueprint’s ready. Read the tests.');
        }
        if (name === 'revise') {
          await click('Request a revision');
          await screen.findByText('Revision requested. No work order or payment was created.');
          fireEvent.change(screen.getByLabelText('What should change?'), { target: { value: 'More reminders' } });
        }
        if (name === 'edit' || name === 'reload') {
          await click('Edit blueprint');
          fireEvent.change(screen.getByLabelText('Project summary'), { target: { value: 'Edited' } });
        }
        if (name === 'reload') {
          server.state.plan = { ...server.state.plan };
          hold = false;
          const failing = api((c) => (c.path === '/plans/bp1/edits' ? { status: 503 } : server.reply(c)));
          void failing;
          await click('Save draft for fresh review');
          api((c) => {
            if (matches(c))
              return new Promise((r) => {
                release = () => r(outcome === 'success' ? server.reply(c) : { status: 503 });
              });
            return server.reply(c);
          });
        }
        hold = true;
        await start();
        view.unmount();
        await act(async () => release());
      }
      expect(screen.queryByRole('alert')).toBeNull();
    });
});
