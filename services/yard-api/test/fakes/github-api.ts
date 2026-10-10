import { createHash } from 'node:crypto';

// T-0188: a scripted GitHub REST API for one App installation: tokens, Git data, contents, tarballs, compare and
// pull requests. Just enough to exercise GitHubRepositories over HTTP without a network.
type Commit = { sha: string; parents: string[]; files: Record<string, string> };
export function githubApi(options: { owner?: string; repos?: Record<string, Record<string, string>> } = {}) {
  const owner = options.owner ?? 'buyer';
  const commits = new Map<string, Commit>();
  const refs = new Map<string, string>(); // "repo:branch" -> sha
  const tokens = new Map<string, { repo: string; permissions: Record<string, string> }>();
  const calls: { method: string; path: string; body: unknown }[] = [];
  const pulls: { repo: string; head: string; base: string; number: number }[] = [];
  let seq = 0;
  const sha = (v: unknown) => createHash('sha1').update(JSON.stringify(v)).digest('hex');
  for (const [name, files] of Object.entries(
    options.repos ?? { project: { 'src/app.ts': 'empty', 'tests/a.test.js': 'signed' } },
  )) {
    const c = { sha: sha([name, files]), parents: [], files };
    commits.set(c.sha, c);
    refs.set(`${owner}/${name}:main`, c.sha);
  }
  const json = (status: number, body?: unknown) =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: url.pathname + url.search, body });
    const auth = new Headers(init?.headers).get('Authorization') ?? '';
    const tokenMatch = /^token (.+)$/.exec(auth);
    const m = /^\/app\/installations\/(\d+)\/access_tokens$/.exec(url.pathname);
    if (m && method === 'POST') {
      if (!/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/.test(auth)) return json(401);
      if (m[1] !== '42') return json(404);
      const repo = `${owner}/${body.repositories[0]}`;
      if (!refs.has(`${repo}:main`)) return json(422);
      const value = `ghs_test_${++seq}`;
      tokens.set(value, { repo, permissions: body.permissions });
      return json(201, { token: value, expires_at: '2026-10-09T13:00:00Z' });
    }
    const r = /^\/repos\/([^/]+\/[^/]+)\/(.+)$/.exec(url.pathname);
    if (!r) return json(404);
    const [, repo = '', rest = ''] = r;
    const token = tokenMatch ? tokens.get(tokenMatch[1] ?? '') : undefined;
    if (!token || token.repo !== repo) return json(404);
    const write = token.permissions.contents === 'write';
    let g: RegExpExecArray | null;
    g = /^git\/ref\/heads\/(.+)$/.exec(rest);
    if (g && method === 'GET') {
      const head = refs.get(`${repo}:${g[1]}`);
      return head ? json(200, { object: { sha: head } }) : json(404);
    }
    g = /^git\/commits\/([a-f0-9]{40})$/.exec(rest);
    if (g && method === 'GET') {
      const c = commits.get(g[1] ?? '');
      return c
        ? json(200, { sha: c.sha, tree: { sha: `tree-${c.sha}` }, parents: c.parents.map((p) => ({ sha: p })) })
        : json(404);
    }
    if (rest === 'git/trees' && method === 'POST') {
      if (!write) return json(403);
      const base = [...commits.values()].find((c) => `tree-${c.sha}` === body.base_tree);
      if (!base) return json(422);
      const files = {
        ...base.files,
        ...Object.fromEntries(body.tree.map((e: { path: string; content: string }) => [e.path, e.content])),
      };
      const id = sha(files);
      commits.set(`pending-${id}`, { sha: id, parents: [], files });
      return json(201, { sha: `tree-pending-${id}` });
    }
    if (rest === 'git/commits' && method === 'POST') {
      if (!write) return json(403);
      const pending = commits.get(String(body.tree).replace(/^tree-/, ''));
      if (!pending) return json(422);
      const c = { sha: sha([pending.files, body.parents]), parents: body.parents, files: pending.files };
      commits.set(c.sha, c);
      return json(201, { sha: c.sha });
    }
    if (rest === 'git/refs' && method === 'POST') {
      if (!write) return json(403);
      const name = String(body.ref).replace('refs/heads/', '');
      if (refs.has(`${repo}:${name}`)) return json(422);
      refs.set(`${repo}:${name}`, body.sha);
      return json(201, {});
    }
    g = /^git\/refs\/heads\/(.+)$/.exec(rest);
    if (g) {
      if (!write) return json(403);
      const key = `${repo}:${g[1]}`;
      if (method === 'DELETE') return refs.delete(key) ? json(204) : json(422);
      if (method === 'PATCH') {
        const current = refs.get(key);
        const next = commits.get(body.sha);
        if (!current || !next) return json(422);
        // Without force, GitHub only moves a ref forward to a descendant.
        const descends = (from: Commit | undefined, depth = 0): boolean =>
          !!from &&
          depth < 100 &&
          (from.sha === current || from.parents.some((p) => descends(commits.get(p), depth + 1)));
        if (!body.force && !descends(next)) return json(422);
        refs.set(key, body.sha);
        return json(200, {});
      }
    }
    g = /^contents\/(.+)$/.exec(rest);
    if (g && method === 'GET') {
      const c = commits.get(url.searchParams.get('ref') ?? '');
      const content = c?.files[decodeURIComponent(g[1] ?? '')];
      return content === undefined ? json(404) : new Response(content, { status: 200 });
    }
    g = /^tarball\/([a-f0-9]{40})$/.exec(rest);
    if (g && method === 'GET')
      return commits.has(g[1] ?? '') ? new Response(new Uint8Array([31, 139, 8, 0]), { status: 200 }) : json(404);
    g = /^compare\/([a-f0-9]{40})\.\.\.([a-f0-9]{40})$/.exec(rest);
    if (g && method === 'GET') {
      let cursor = commits.get(g[2] ?? '');
      let ahead = 0;
      while (cursor && cursor.sha !== g[1] && ahead < 100) {
        cursor = commits.get(cursor.parents[0] ?? '');
        ahead++;
      }
      return json(200, {
        status: cursor ? (ahead ? 'ahead' : 'identical') : 'diverged',
        ahead_by: ahead,
        behind_by: cursor ? 0 : 1,
      });
    }
    if (rest === 'pulls' && method === 'POST') {
      if (token.permissions.pull_requests !== 'write') return json(403);
      const pull = { repo, head: body.head, base: body.base, number: pulls.length + 1 };
      pulls.push(pull);
      return json(201, { number: pull.number });
    }
    if (rest === 'pulls' && method === 'GET')
      return json(
        200,
        pulls.filter((p) => p.repo === repo && `${owner}:${p.head}` === url.searchParams.get('head')),
      );
    return json(404);
  };
  return { fetch: fetch as typeof globalThis.fetch, calls, refs, tokens, pulls };
}
