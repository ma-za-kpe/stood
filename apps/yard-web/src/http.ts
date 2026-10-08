export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
export async function api(path: string, options?: RequestInit) {
  const response = await fetch(`/app/api${path}`, {
    ...options,
    signal: options?.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(20_000)])
      : AbortSignal.timeout(20_000),
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
