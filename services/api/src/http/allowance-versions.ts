import type { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { allowanceDraft } from '../application/allowance-draft.js';
import { mandateTermsHash } from '../application/mandate-terms.js';
import { type AllowanceVersion, AllowanceVersionError } from '../ports/allowance-version-store.js';
import type { PlatformApiConfig } from './platform-api-config.js';

export const versionNumber = (value: string | undefined): number | null => {
  if (!value || !/^[1-9][0-9]{0,9}$/.test(value)) return null;
  const number = Number(value);
  return number <= 2147483647 ? number : null;
};
const view = (value: AllowanceVersion) => ({ ...value, terms_hash: mandateTermsHash(value.body, value.version) });
export function allowanceVersionRoutes(
  app: Hono,
  config: PlatformApiConfig,
  problem: (status: ContentfulStatusCode, code: string, detail: string) => Response,
) {
  app.get('/allowances/:id/versions/:version', async (c) => {
    if (!config.versions) return problem(503, 'versions_not_configured', 'Allowance versions are not configured.');
    const raw = c.req.param('version');
    const version = raw === 'current' ? undefined : versionNumber(raw);
    if (version === null) return problem(422, 'validation', 'Use a positive terms version or current.');
    const value = await config.versions.read(config.platformId, c.req.param('id'), version);
    return value ? c.json(view(value)) : problem(404, 'not_found', 'Allowance version not found.');
  });
  app.post('/allowances/:id/versions', async (c) => {
    if (!config.versions) return problem(503, 'versions_not_configured', 'Allowance versions are not configured.');
    const key = c.req.header('Idempotency-Key') ?? '';
    if (!key.trim() || key.length > 200 || !/^application\/json(?:;|$)/i.test(c.req.header('Content-Type') ?? ''))
      return problem(422, 'validation', 'JSON and an idempotency key are required.');
    let expected: number;
    let terms: ReturnType<typeof allowanceDraft>;
    try {
      const input = JSON.parse(await c.req.text());
      if (
        !input ||
        typeof input !== 'object' ||
        Array.isArray(input) ||
        Object.keys(input).sort().join() !== 'expected_version,terms' ||
        !Number.isInteger(input.expected_version) ||
        input.expected_version < 1 ||
        input.expected_version >= 2147483647
      )
        throw new RangeError('Invalid version request');
      expected = input.expected_version;
      terms = allowanceDraft(input.terms);
    } catch {
      return problem(422, 'validation', 'Supply the expected version and complete proposed terms.');
    }
    try {
      return c.json(
        view(await config.versions.propose(config.platformId, c.req.param('id'), key, expected, terms)),
        201,
      );
    } catch (error) {
      if (error instanceof AllowanceVersionError) {
        if (error.code === 'NOT_FOUND') return problem(404, 'not_found', 'Allowance not found.');
        if (error.code === 'INVALID') return problem(422, 'validation', 'Invalid amendment request.');
        return problem(409, error.code.toLowerCase(), 'Read the allowance version and retry with matching terms.');
      }
      if (error instanceof RangeError)
        return problem(409, 'amendment_conflict', 'The amendment changes protected or unchanged terms.');
      throw error;
    }
  });
}
