import { expect, it } from 'vitest';
import { intakeFixture } from '../../../packages/yard-contracts/test/fakes/intake.js';
import { foremanChoices, formDraft, formValues, majorToMinor } from './intake-form.js';

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

// T-0275: every step's Foreman choices are explicit and valid; conversions refuse impossible input.
it('offers valid Foreman choices for every step and never fills in the idea, budget or sign-off', () => {
  for (let step = 0; step < 8; step++) {
    const choices = foremanChoices(step);
    expect(Object.keys(choices).length).toBeGreaterThan(0);
    expect(Object.keys(choices)).not.toContain('idea.description');
    expect(Object.keys(choices)).not.toContain('timing.capMinor');
    expect(Object.keys(choices)).not.toContain('timing.signoffName');
    expect(() => formDraft(choices)).not.toThrow();
  }
});
it('refuses impossible dates, non-boolean answers and malformed services, and round-trips money and services', () => {
  expect(() => formDraft({ 'timing.deadline': '2026-02-30T10:00' })).toThrow('Choose a valid UTC deadline.');
  expect(() => formDraft({ 'timing.deadline': 'tomorrow' })).toThrow('Choose a valid UTC deadline.');
  expect(() => formDraft({ 'handover.consent': 'maybe' })).toThrow('Choose yes or no.');
  expect(() => formDraft({ 'services.selected': 'database supabase' })).toThrow('Use CATEGORY: Provider');
  const draft = formDraft({
    'timing.capMinor': '1234.5',
    'services.selected': 'DATABASE: Supabase\n\nPAYMENTS: PayPal',
    'handover.consent': 'true',
    'idea.users': 'owners\n\n customers ',
  });
  expect(draft).toMatchObject({
    timing: { capMinor: 123450 },
    services: {
      selected: [
        { category: 'DATABASE', provider: 'Supabase' },
        { category: 'PAYMENTS', provider: 'PayPal' },
      ],
    },
    handover: { consent: true },
    idea: { users: ['owners', 'customers'] },
  });
  expect(formValues(draft)).toMatchObject({
    'timing.capMinor': '1234.50',
    'services.selected': 'DATABASE: Supabase\nPAYMENTS: PayPal',
    'handover.consent': 'true',
    'idea.users': 'owners\ncustomers',
  });
  expect(() => majorToMinor('0.01')).toThrow('outside the supported range');
});
