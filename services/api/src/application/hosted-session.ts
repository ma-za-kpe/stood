// A rejected session did not authenticate the operation. Repeat it once with fresh credentials and the same
// request identity; ambiguous transport failures must still be reconciled by the caller.
export async function hostedSession(
  login: () => Promise<string>,
  send: (cookie: string, path: string, request: RequestInit) => Promise<Response>,
) {
  let cookie = await login();
  return async (path: string, request: RequestInit): Promise<Response> => {
    const result = await send(cookie, path, request);
    if (result.status !== 401) return result;
    await result.body?.cancel();
    cookie = await login();
    return send(cookie, path, request);
  };
}
