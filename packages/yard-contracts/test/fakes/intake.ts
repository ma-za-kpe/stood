import type { CompleteIntake } from '../../src/intake.js';
// Synthetic choices only; no credentials, repository access or financial approval.
export function intakeFixture(now: number): CompleteIntake {
  return {
    idea: {
      description: 'Build a booking app',
      users: ['customers'],
      proofFlow: 'Book a slot',
      references: [],
      assets: [],
    },
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
    services: { selected: [{ category: 'DATABASE', provider: 'Supabase' }], decide: false },
    timing: {
      capMinor: 3000,
      currency: 'USD',
      deadline: now + 21 * 86400000,
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
}
