import { expect, it } from 'vitest';
import { siteLogBatchChecked } from './site-log.js';

it('accepts bounded plain-text progress with fixed kinds and validated facts', () => {
  const lines = [
    { kind: 'plan', message: 'Working on the booking route' },
    { kind: 'test_run', message: '12 of 14 tests pass', data: { passed: 12, total: 14 } },
    { kind: 'commit', message: 'Pushed the booking route', data: { sha: 'a'.repeat(40) } },
  ];
  expect(siteLogBatchChecked({ lines })).toEqual(lines);
});
it('rejects secret-bearing, invented, executable or oversized progress before storage', () => {
  for (const value of [
    { lines: [{ kind: 'note', message: 'client_secret = synthetic-secret-value' }] },
    { lines: [{ kind: 'note', message: 'ghp_' + 'a'.repeat(36) }] },
    { lines: [{ kind: 'thought', message: 'Private reasoning' }] },
    { lines: [{ kind: 'note', message: '<script>alert(1)</script>' }] },
    { lines: [{ kind: 'note', message: Array(21).fill('file content').join('\n') }] },
    { lines: [{ kind: 'test_run', message: 'All pass', data: { passed: 15, total: 14 } }] },
    { lines: [{ kind: 'note', message: 'Build', data: { api_key: 'synthetic-secret-value' } }] },
    { lines: [{ kind: 'commit', message: 'Build', data: { sha: 'invalid' } }] },
    { lines: [] },
    { lines: Array(21).fill({ kind: 'note', message: 'Build' }) },
    { lines: [{ kind: 'note', message: 'x'.repeat(2049) }] },
    { lines: [{ kind: 'note', message: 'Build', at: '2026-10-05' }] },
    { lines: [{ kind: 'note', message: 'Build' }], actor: 'stood' },
  ])
    expect(() => siteLogBatchChecked(value)).toThrow();
});
