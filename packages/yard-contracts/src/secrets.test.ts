import { expect, it } from 'vitest';
import { SECRET_PROVIDERS, secretInputProblem } from './secrets.js';

it('shares the provider allowlist and checks the key form before it is sent (T-0195)', () => {
  const ok = {
    name: 'SUPABASE_URL',
    provider: 'supabase',
    environment: 'TEST' as const,
    value: 'https://x.supabase.co',
  };
  expect(secretInputProblem(ok)).toBeNull();
  expect(secretInputProblem({ ...ok, name: 'supabase_url' })).toBe('NAME');
  expect(secretInputProblem({ ...ok, provider: 'github' })).toBe('PROVIDER');
  expect(secretInputProblem({ ...ok, environment: 'PROD' as never })).toBe('ENVIRONMENT');
  expect(secretInputProblem({ ...ok, value: '   ' })).toBe('VALUE');
  expect(SECRET_PROVIDERS).not.toContain('github');
  expect(SECRET_PROVIDERS).not.toContain('render');
  expect(Object.isFrozen(SECRET_PROVIDERS)).toBe(true);
});
