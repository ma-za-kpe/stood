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
