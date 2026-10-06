import { expect, it } from 'vitest';
import { applyLogEvent, logChecked } from './log-state.js';

const empty = { version: 0, retainedFrom: 1, lines: [], summary: null };
const event = {
  seq: 1,
  actor: 'builder',
  at: '2026-10-05T00:00:00.001Z',
  type: 'site_log.line',
  payload: { kind: 'note', message: 'Building bookings' },
};
it('requires consecutive display-only events and never derives payment from log text', () => {
  const initial = logChecked(empty);
  const next = applyLogEvent(initial, event);
  expect(next).toMatchObject({ version: 1, lines: [{ seq: 1, line: event.payload }] });
  if (next === 'GAP') throw new Error('Expected log');
  expect(applyLogEvent(next, event)).toBe(next);
  for (const bad of [
    { ...event, seq: 2 },
    { ...event, type: 'stood.released' },
    { ...event, payload: { kind: 'note', message: 'Paid', state: 'PAID' } },
    { ...event, at: 'invalid' },
  ])
    expect(applyLogEvent(initial, bad)).toBe('GAP');
  expect(Object.keys(next)).not.toContain('payment');
});
it('validates retained history, summary counts and recognised credential rejection', () => {
  const valid = {
    version: 2,
    retainedFrom: 2,
    lines: [{ seq: 2, actor: 'builder', at: event.at, line: event.payload }],
    summary: { through: 1, count: 1, kinds: { note: 1 } },
  };
  expect(logChecked(valid)).toEqual(valid);
  for (const bad of [
    null,
    { ...valid, retainedFrom: 1 },
    { ...valid, version: 3 },
    { ...valid, summary: { through: 1, count: 9, kinds: { note: 1 } } },
    { ...valid, summary: { through: 2, count: 2, kinds: { invented: 2 } } },
    {
      ...valid,
      lines: [{ ...valid.lines[0], line: { kind: 'note', message: 'client_secret = synthetic-secret-value' } }],
    },
    { ...empty, version: 1 },
    { ...valid, lines: [{ ...valid.lines[0], at: '2026-02-31T00:00:00Z' }] },
  ])
    expect(() => logChecked(bad)).toThrow();
});
it('retains only the latest 200 rows without resetting the authoritative sequence', () => {
  let current = logChecked(empty);
  for (let seq = 1; seq <= 205; seq++) {
    const next = applyLogEvent(current, { ...event, seq });
    if (next === 'GAP') throw new Error('Expected event');
    current = next;
  }
  expect(current).toMatchObject({ version: 205, retainedFrom: 6 });
  expect(current.lines).toHaveLength(200);
});
