import { expect, it } from 'vitest';
import { completeIntakeChecked, intakeChecked } from './intake.js';
import { assertPublicInput } from './public-input.js';

it('accepts partial steps and preserves service choices without credential fields', () => {
  const input = {
    idea: { description: 'A booking app with password reset' },
    services: { decide: false, selected: [{ category: 'DATABASE', provider: 'Supabase' }] },
  };
  expect(intakeChecked(input)).toEqual(input);
  expect(intakeChecked({})).toEqual({});
  for (const unsafe of [
    { ...input, secrets: {} },
    { services: { decide: true, selected: [], apiKey: 'placeholder' } },
    { services: { selected: [{ category: 'DATABASE', provider: 'Supabase', credentials: {} }] } },
    { handover: { repository: '../private' } },
    { idea: { references: ['https://user:pass@example.com'] } },
    { timing: { capMinor: 1.5 } },
    { timing: { currency: 'GHS' } },
  ])
    expect(() => intakeChecked(unsafe)).toThrow('INVALID_INTAKE');
});
it('blocks recognised test and live credentials in any nested free-text field without echoing them', () => {
  const tokens = [
    ['sk', 'test', ''].join('_') + 'synthetic',
    ['sk', 'live', ''].join('_') + 'synthetic',
    ['github', 'pat', ''].join('_') + 'synthetic',
    'client_secret = synthetic-secret-value',
    ['-----BEGIN ', 'PRIVATE KEY-----'].join('') + '\nsynthetic\n',
    ['AK', 'IA'].join('') + 'A'.repeat(16),
    ['AI', 'za'].join('') + 'a'.repeat(32),
  ];
  for (const token of tokens) {
    try {
      intakeChecked({ services: { selected: [{ category: 'DATABASE', provider: token }] } });
      throw new Error('Expected scanner refusal');
    } catch (error) {
      expect((error as Error).message).toBe('CREDENTIAL_IN_INTAKE');
      expect(String(error)).not.toContain(token);
    }
  }
  expect(() => assertPublicInput({ idea: ['sk', '\u200B_live_', 'synthetic'].join('') })).toThrow(
    'CREDENTIAL_IN_INTAKE',
  );
});
it('bounds malformed or oversized input before validation', () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  for (const value of [cyclic, undefined, { idea: 'x'.repeat(49153) }, { idea: '🙂'.repeat(20000) }])
    expect(() => assertPublicInput(value)).toThrow('INVALID_INTAKE');
});
it('requires complete consented terms and a future deadline before planning', () => {
  expect(() => completeIntakeChecked({}, 100)).toThrow('INVALID_INTAKE');
  const input = {
    idea: { description: 'Build bookings', users: ['customers'], proofFlow: 'Book a slot', references: [], assets: [] },
    audience: {
      platforms: ['WEB'],
      countries: ['Ghana'],
      currencies: ['USD'],
      languages: ['English'],
      usersMonth1: 'FOREMAN',
      usersMonth12: 'FOREMAN',
      accessibility: ['WCAG AA'],
      offline: 'FOREMAN',
    },
    features: { selected: ['BOOKINGS'], details: 'Let the Foreman decide' },
    data: {
      categories: ['people'],
      personalData: 'YES',
      regimes: ['FOREMAN'],
      residency: ['FOREMAN'],
      importSource: 'None',
      retention: 'FOREMAN',
    },
    stack: { choice: 'FOREMAN', language: 'FOREMAN', framework: 'FOREMAN', database: 'FOREMAN', cloud: 'FOREMAN' },
    services: { selected: [], decide: true },
    timing: {
      capMinor: 3000,
      currency: 'USD',
      deadline: 200,
      pace: 'FOREMAN',
      signoffName: 'Demo buyer',
      signoffEmail: 'buyer@example.invalid',
    },
    handover: {
      repository: 'buyer/project',
      baseCommit: 'a'.repeat(40),
      production: 'RENDER',
      domain: 'None',
      licence: 'Proprietary',
      maintainer: 'Me',
      consent: true,
    },
  };
  expect(completeIntakeChecked(input, 100)).toEqual(input);
  for (const now of [200, 201, NaN, -1]) expect(() => completeIntakeChecked(input, now)).toThrow('INVALID_INTAKE');
  expect(() => completeIntakeChecked({ ...input, handover: { ...input.handover, consent: false } }, 100)).toThrow(
    'INVALID_INTAKE',
  );
  expect(() => completeIntakeChecked({ ...input, idea: { ...input.idea, users: [] } }, 100)).toThrow('INVALID_INTAKE');
});

it('keeps separate bounded intake and model-output scan limits', () => {
  const output = { text: 'x'.repeat(50000) };
  expect(() => assertPublicInput(output)).toThrow('INVALID_INTAKE');
  expect(() => assertPublicInput(output, 'MODEL')).not.toThrow();
  expect(() => assertPublicInput({ text: 'x'.repeat(65536) }, 'MODEL')).toThrow('INVALID_INTAKE');
  expect(() => assertPublicInput(output, 'unbounded' as 'MODEL')).toThrow('INVALID_INTAKE');
});
