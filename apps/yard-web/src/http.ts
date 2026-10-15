export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
export const API_TIMEOUT_MS = 20_000;
export const PLANNER_TIMEOUT_MS = 180_000;

export function plannerFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'The planner could not complete this request.';
  const timedOut = error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name);
  const providerUnavailable = error instanceof ApiError && error.status >= 500;
  if (timedOut || providerUnavailable || /signal timed out|request timed out/i.test(message))
    return 'The AI planner could not return a response. This may be a temporary xAI outage or an exhausted xAI quota. Your saved brief is safe; check the xAI usage and credits, then retry. If a request timed out, use Recover saved planning attempt when it is offered.';
  return message;
}

export async function api(path: string, options?: RequestInit, timeoutMs = API_TIMEOUT_MS) {
  const response = await fetch(`/app/api${path}`, {
    ...options,
    signal: options?.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs),
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  if (!response.ok)
    throw new ApiError(
      response.status,
      response.status === 401
        ? 'Sign in to open the room.'
        : response.status === 403
          ? 'This operator does not have access. Claim work from the Board first.'
          : response.status === 409
            ? 'The work changed. Reload its current record before trying again.'
            : response.status === 404
              ? 'No project with that ID.'
              : 'The service could not complete this request. Retry when it is available.',
    );
  return response.json() as Promise<unknown>;
}
