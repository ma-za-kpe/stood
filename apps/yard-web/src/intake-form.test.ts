import { expect, it } from 'vitest';
import { intakeFixture } from '../../../packages/yard-contracts/test/fakes/intake.js';
import { formDraft, formValues, majorToMinor } from './intake-form.js';

const now = 1791158400000;
it('converts money exactly and refuses precision loss and malformed values', () => {
  expect(majorToMinor('123.45')).toBe(12345);
  expect(majorToMinor('0.03')).toBe(3);
  for (const value of ['0.001', '1e3', '-1', '90071992547409.92', '1,000', 'NaN'])
    expect(() => majorToMinor(value)).toThrow();
});
it('round trips every intake choice without asking the buyer for a commit hash', () => {
  const complete = intakeFixture(now);
  const draft = formDraft(formValues(complete));
  const { baseCommit: _, ...handover } = complete.handover;
  expect(draft).toEqual({ ...complete, handover });
});
it('blocks recognised credentials in raw form values before dropping blank or unknown fields', () => {
  const values = formValues({ idea: { description: 'A booking app' } });
  values['idea.description'] = 'client_secret = synthetic-secret-value';
  expect(() => formDraft(values)).toThrow('CREDENTIAL_IN_INTAKE');
});
it('preserves an unfinished draft and rejects invalid service rows', () => {
  expect(formDraft({ 'idea.description': 'Book appointments' })).toEqual({
    idea: { description: 'Book appointments' },
  });
  expect(() => formDraft({ 'services.selected': 'DATABASE: Supabase\nnot-a-service' })).toThrow();
});
