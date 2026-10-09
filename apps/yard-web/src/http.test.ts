// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { api as stub } from '../test/harness.js';
import { ApiError, api } from './http.js';

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
