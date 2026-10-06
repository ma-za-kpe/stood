import type { CompleteIntake, intakeFields } from './intake.js';

// How each intake answer is treated (docs/yard/Y22-privacy-and-data.md). PERSONAL answers identify a
// person; BUSINESS answers describe the product. Credentials are never intake fields (Y19 refuses them).
export type DataClass = 'PERSONAL' | 'BUSINESS';
// Who may read the answer: the buyer only, or also the builders who claim its work (via the blueprint).
export type DataAudience = 'BUYER_ONLY' | 'BUYER_AND_BUILDERS';
type Steps = typeof intakeFields;
type FieldPath = { [S in keyof Steps]: `${S & string}.${keyof Steps[S]['shape'] & string}` }[keyof Steps];
export const INTAKE_DATA_CLASSES: Readonly<Record<FieldPath, readonly [DataClass, DataAudience]>> = Object.freeze({
  'idea.description': ['BUSINESS', 'BUYER_AND_BUILDERS'],
  'idea.users': ['BUSINESS', 'BUYER_AND_BUILDERS'],
  'idea.proofFlow': ['BUSINESS', 'BUYER_AND_BUILDERS'],
  'idea.references': ['BUSINESS', 'BUYER_AND_BUILDERS'],
  'idea.assets': ['BUSINESS', 'BUYER_AND_BUILDERS'],
  'audience.platforms': ['BUSINESS', 'BUYER_AND_BUILDERS'],
  'audience.countries': ['BUSINESS', 'BUYER_AND_BUILDERS'],
  'audience.currencies': ['BUSINESS', 'BUYER_AND_BUILDERS'],
  'audience.languages': ['BUSINESS', 'BUYER_AND_BUILDERS'],
  'audience.usersMonth1': ['BUSINESS', 'BUYER_AND_BUILDERS'],
  'audience.usersMonth12': ['BUSINESS', 'BUYER_AND_BUILDERS'],
  'audience.accessibility': ['BUSINESS', 'BUYER_AND_BUILDERS'],
  'audience.offline': ['BUSINESS', 'BUYER_AND_BUILDERS'],
  'features.selected': ['BUSINESS', 'BUYER_AND_BUILDERS'],
  'features.details': ['BUSINESS', 'BUYER_AND_BUILDERS'],
  'data.categories': ['BUSINESS', 'BUYER_AND_BUILDERS'],
  'data.personalData': ['BUSINESS', 'BUYER_AND_BUILDERS'],
  'data.regimes': ['BUSINESS', 'BUYER_AND_BUILDERS'],
  'data.residency': ['BUSINESS', 'BUYER_AND_BUILDERS'],
  'data.importSource': ['BUSINESS', 'BUYER_AND_BUILDERS'],
  'data.retention': ['BUSINESS', 'BUYER_AND_BUILDERS'],
  'stack.choice': ['BUSINESS', 'BUYER_AND_BUILDERS'],
  'stack.language': ['BUSINESS', 'BUYER_AND_BUILDERS'],
  'stack.framework': ['BUSINESS', 'BUYER_AND_BUILDERS'],
  'stack.database': ['BUSINESS', 'BUYER_AND_BUILDERS'],
  'stack.cloud': ['BUSINESS', 'BUYER_AND_BUILDERS'],
  'services.selected': ['BUSINESS', 'BUYER_AND_BUILDERS'],
  'services.decide': ['BUSINESS', 'BUYER_AND_BUILDERS'],
  'timing.capMinor': ['BUSINESS', 'BUYER_ONLY'],
  'timing.currency': ['BUSINESS', 'BUYER_AND_BUILDERS'],
  'timing.deadline': ['BUSINESS', 'BUYER_AND_BUILDERS'],
  'timing.pace': ['BUSINESS', 'BUYER_AND_BUILDERS'],
  'timing.signoffName': ['PERSONAL', 'BUYER_ONLY'],
  'timing.signoffEmail': ['PERSONAL', 'BUYER_ONLY'],
  'handover.repository': ['BUSINESS', 'BUYER_AND_BUILDERS'],
  'handover.baseCommit': ['BUSINESS', 'BUYER_AND_BUILDERS'],
  'handover.production': ['BUSINESS', 'BUYER_AND_BUILDERS'],
  'handover.domain': ['BUSINESS', 'BUYER_AND_BUILDERS'],
  'handover.licence': ['BUSINESS', 'BUYER_AND_BUILDERS'],
  'handover.maintainer': ['PERSONAL', 'BUYER_ONLY'],
  'handover.consent': ['BUSINESS', 'BUYER_ONLY'],
});

// Retention, in days after the event named. Y18: blueprint events are the audit trail.
export const RETENTION = Object.freeze({
  siteLogText: 90,
  testKeysAfterHandover: 7,
  blueprintEvents: 'kept as the payment audit trail; personal answers are never written to them',
  previewsMax: 30,
  intakeDrafts: 'kept until deletion is built; automatic expiry is not implemented yet',
} as const);

// Shown before an operator registers. One text for people, one for the operator who runs an agent.
export const BUILDER_CONSENT = Object.freeze({
  HUMAN:
    'Yard keeps your operator name, your PayPal payee reference and the work you submit, so buyers can check it and Stood can pay you. Buyers see your operator name and work; they never see your payee reference. Your work history stays as the payment record.',
  AGENT:
    'You are responsible for the agent you register. Yard keeps the operator name, PayPal payee reference and everything the agent submits or logs, so buyers can check it and Stood can pay you. Build logs are deleted after 90 days. Agents must not put personal data or keys in logs or commits.',
} as const);

// The planner model never sees who the buyer's people are. The placeholders keep the intake schema-valid.
export function withheldForPlanner(intake: CompleteIntake): CompleteIntake {
  return {
    ...intake,
    timing: { ...intake.timing, signoffName: 'withheld', signoffEmail: 'withheld@yard.invalid' },
    handover: { ...intake.handover, maintainer: 'withheld' },
  };
}
