import { expect, it } from 'vitest';
import { databaseUrlProblem } from './connection-policy.js';

const neon = (params: string, host = 'ep-x-1.c-6.eu-central-1.aws.neon.tech') =>
  `postgresql://owner:s3cret-password@${host}/neondb?${params}`;

it('requires verified TLS and the direct host outside local and CI, and never repeats the URL (T-0254)', () => {
  expect(databaseUrlProblem(neon('sslmode=verify-full&channel_binding=require'), 'demo')).toBeNull();
  for (const params of ['sslmode=require', 'sslmode=prefer', 'sslmode=disable', 'channel_binding=require', ''])
    expect(databaseUrlProblem(neon(params), 'demo')).toBe('DATABASE_URL must use sslmode=verify-full');
  expect(databaseUrlProblem(neon('sslmode=verify-full', 'ep-x-1-pooler.c-6.eu-central-1.aws.neon.tech'), 'demo')).toBe(
    'DATABASE_URL must be the direct (unpooled) host: Stood uses LISTEN',
  );
  expect(databaseUrlProblem('not a url', 'demo')).toBe('DATABASE_URL is not a valid URL');
  for (const env of ['local', 'ci'])
    expect(databaseUrlProblem('postgres://stood:stood_local_only@db:5432/stood', env)).toBeNull();
  for (const appEnv of ['demo', 'local'])
    expect(databaseUrlProblem(neon('sslmode=require'), appEnv) ?? '').not.toContain('s3cret');
});
