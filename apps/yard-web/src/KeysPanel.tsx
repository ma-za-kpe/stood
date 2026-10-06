import { SECRET_PROVIDERS, secretInputProblem } from '@stood/yard-contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { z } from 'zod';
import { browserRequestKey } from './claim-keys.js';
import { ApiError, api } from './http.js';

const listed = z
  .object({
    secrets: z.array(
      z
        .object({
          name: z.string(),
          provider: z.string(),
          environment: z.enum(['TEST', 'DEV']),
          version: z.number().int().positive(),
          fingerprint: z.string(),
          createdAt: z.number().int(),
        })
        .strict(),
    ),
    simulated: z.literal(true),
  })
  .strict();
const problems = {
  NAME: 'Use an environment-variable name, for example SUPABASE_URL.',
  PROVIDER: 'Choose a listed provider.',
  ENVIRONMENT: 'Choose test or dev.',
  VALUE: 'Paste the test key.',
} as const;
// Y19 step 9: write-only test keys after signing. The value lives only in this form until it is sent.
export function KeysPanel({ projectId, version, signed }: { projectId: string; version: number; signed: boolean }) {
  const client = useQueryClient();
  const ids = useId();
  const queryKey = ['secrets', projectId];
  const [name, setName] = useState('');
  const [provider, setProvider] = useState('supabase');
  const [environment, setEnvironment] = useState<'TEST' | 'DEV'>('TEST');
  const [value, setValue] = useState('');
  const [message, setMessage] = useState('');
  const secrets = useQuery({
    queryKey,
    enabled: signed,
    queryFn: async ({ signal }) =>
      listed.parse(await api(`/blueprints/${encodeURIComponent(projectId)}/secrets`, { signal })).secrets,
  });
  const command = (path: string, method: string, body: unknown) =>
    api(path, {
      method,
      body: JSON.stringify(body),
      headers: { 'If-Match': String(version), 'Idempotency-Key': `secret-${browserRequestKey()}` },
    });
  const save = useMutation({
    mutationFn: (input: { name: string; provider: string; environment: 'TEST' | 'DEV'; value: string }) =>
      command(`/blueprints/${encodeURIComponent(projectId)}/secrets/${input.name}`, 'PUT', {
        provider: input.provider,
        environment: input.environment,
        value: input.value,
      }),
    onSuccess: () => setMessage('Stored encrypted. You can replace it, never read it back.'),
    onError: (e) =>
      setMessage(
        e instanceof ApiError && e.status === 422
          ? 'Refused. Only test or dev keys are accepted; live keys go into your own hosting at handover.'
          : (e as Error).message,
      ),
    onSettled: () => client.invalidateQueries({ queryKey }),
  });
  const revoke = useMutation({
    mutationFn: (secret: string) =>
      command(`/blueprints/${encodeURIComponent(projectId)}/secrets/${secret}/revoke`, 'POST', {}),
    onSettled: () => client.invalidateQueries({ queryKey }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const input = { name: name.trim(), provider, environment, value };
    const problem = secretInputProblem(input);
    if (problem) return setMessage(problems[problem]);
    setValue(''); // Never keep the value after it is sent.
    save.mutate(input);
  };
  if (!signed)
    return (
      <section className="keys" aria-labelledby="keys-title">
        <h3 id="keys-title">Test keys</h3>
        <p className="fine">Keys are asked for after you sign, and only test or dev keys.</p>
      </section>
    );
  return (
    <section className="keys" aria-labelledby="keys-title">
      <p className="eyebrow">Step 9</p>
      <h3 id="keys-title">Test keys</h3>
      <p className="fine">Test keys only. Your real keys go into your own hosting at the end. Yard never sees them.</p>
      <form onSubmit={submit} autoComplete="off">
        <label htmlFor={`${ids}-name`}>Name</label>
        <input
          id={`${ids}-name`}
          value={name}
          onChange={(e) => setName(e.target.value.toUpperCase())}
          placeholder="SUPABASE_URL"
        />
        <label htmlFor={`${ids}-provider`}>Provider</label>
        <select id={`${ids}-provider`} value={provider} onChange={(e) => setProvider(e.target.value)}>
          {SECRET_PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <fieldset>
          <legend>Environment</legend>
          {(['TEST', 'DEV'] as const).map((env) => (
            <label key={env}>
              <input
                type="radio"
                name="environment"
                checked={environment === env}
                onChange={() => setEnvironment(env)}
              />
              {env === 'TEST' ? 'Test' : 'Dev'}
            </label>
          ))}
        </fieldset>
        <label htmlFor={`${ids}-value`}>Value</label>
        <input
          id={`${ids}-value`}
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <button type="submit" className="primary" disabled={save.isPending}>
          {save.isPending ? 'Storing…' : 'Store test key'}
        </button>
        <p className="fine" role="status">
          {message}
        </p>
      </form>
      <ul className="key-list" aria-label="Stored test keys">
        {(secrets.data ?? []).map((s) => (
          <li key={s.name}>
            <code>{s.name}</code> {s.provider} · {s.environment === 'TEST' ? 'test' : 'dev'} · v{s.version}{' '}
            <button type="button" onClick={() => revoke.mutate(s.name)} disabled={revoke.isPending}>
              Revoke
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
