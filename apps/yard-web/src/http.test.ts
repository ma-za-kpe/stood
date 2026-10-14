// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { api as stub } from '../test/harness.js';
import { API_TIMEOUT_MS, ApiError, api, PLANNER_TIMEOUT_MS } from './http.js';

// T-0275: each refusal reads as one plain sentence; the status stays available to callers.
it('turns each refusal into a plain sentence and keeps its status', async () => {
  for (const [status, text] of [
    [401, 'Sign in to open the room.'],
    [403, 'This operator does not have access. Claim work from the Board first.'],
    [409, 'The work changed. Reload its current record before trying again.'],
    [404, 'No project with that ID.'],
    [500, 'The service could not complete this request. Retry when it is available.'],
  ] as const) {
    stub(() => ({ status }));
    const error = await api('/x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status, message: text });
  }
  stub(() => ({ body: { ok: true } }));
  expect(await api('/x', { signal: new AbortController().signal })).toEqual({ ok: true });
});

it('gives planner calls a longer timeout while keeping the ordinary API timeout bounded', async () => {
  const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => new AbortController().signal);
  try {
    stub(() => ({ body: { ok: true } }));
    await api('/intakes/example/plan');
    expect(timeout).toHaveBeenLastCalledWith(API_TIMEOUT_MS);

    await api('/intakes/example/plan', undefined, PLANNER_TIMEOUT_MS);
    expect(timeout).toHaveBeenLastCalledWith(PLANNER_TIMEOUT_MS);
  } finally {
    timeout.mockRestore();
  }
});
