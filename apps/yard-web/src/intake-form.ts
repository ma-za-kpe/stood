import { assertPublicInput, type IntakeDraft, intakeChecked, intakeSteps } from '@stood/yard-contracts';
export type IntakeValues = Record<string, string>;
export type IntakeField = Readonly<{
  path: string;
  label: string;
  why: string;
  kind?: 'list' | 'services' | 'money' | 'date' | 'boolean' | 'long';
  choices?: readonly string[];
}>;
const field = (
  path: string,
  label: string,
  why: string,
  kind?: IntakeField['kind'],
  choices?: readonly string[],
): IntakeField => ({ path, label, why, ...(kind ? { kind } : {}), ...(choices ? { choices } : {}) });
export const formFields: readonly (readonly IntakeField[])[] = [
  [
    field('idea.description', 'What are we building?', 'The Foreman turns this into scope and tests.', 'long'),
    field('idea.users', 'Who uses it?', 'Roles become access rules. One per line.', 'list'),
    field('idea.proofFlow', 'The flow that proves it works', 'This becomes the handover test.'),
    field('idea.references', 'Reference links', 'Scope inspiration only. One URL per line.', 'list'),
    field('idea.assets', 'Existing asset links', 'Avoid rebuilding your existing work. One URL per line.', 'list'),
  ],
  [
    field('audience.platforms', 'Platforms', 'WEB, PWA, IOS, ANDROID, API or FOREMAN; one per line.', 'list'),
    field('audience.countries', 'Countries', 'Choose hosting regions and local requirements.', 'list'),
    field(
      'audience.currencies',
      'Customer currencies',
      'Your app payments are separate from builder payments.',
      'list',
    ),
    field('audience.languages', 'Languages', 'Choose which interfaces to translate.', 'list'),
    field('audience.usersMonth1', 'Users in month one', 'Choose the initial hosting tier.', undefined, [
      'FOREMAN',
      'UNDER_100',
      'UNDER_1000',
      'UNDER_10000',
      'MORE',
    ]),
    field('audience.usersMonth12', 'Users in month twelve', 'Plan room to grow.', undefined, [
      'FOREMAN',
      'UNDER_100',
      'UNDER_1000',
      'UNDER_10000',
      'MORE',
    ]),
    field('audience.accessibility', 'Accessibility needs', 'These become acceptance tests.', 'list'),
    field('audience.offline', 'Offline or low bandwidth', 'Changes storage and synchronisation.', undefined, [
      'FOREMAN',
      'YES',
      'NO',
    ]),
  ],
  [
    field(
      'features.selected',
      'Features',
      'AUTH, PAYMENTS, BOOKINGS, NOTIFICATIONS, UPLOADS, ADMIN, SEARCH, MAPS, AI, ANALYTICS, OTHER or FOREMAN. One per line.',
      'list',
    ),
    field('features.details', 'Feature details', 'Describe who can do what, or ask the Foreman to decide.', 'long'),
  ],
  [
    field('data.categories', 'Data categories', 'People, money, health, children, location or documents.', 'list'),
    field('data.personalData', 'Personal data', 'Shapes consent and deletion tests.', undefined, [
      'FOREMAN',
      'YES',
      'NO',
    ]),
    field('data.regimes', 'Applicable privacy rules', 'Tell the Foreman what applies; one per line.', 'list'),
    field('data.residency', 'Where data must stay', 'Choose permitted regions, or FOREMAN.', 'list'),
    field('data.importSource', 'Existing data to import', 'A migration may need its own milestone.'),
    field('data.retention', 'Backups and retention', 'Shapes deletion and recovery tests.'),
  ],
  [
    field('stack.choice', 'Stack preference', 'Use a supported stack or your existing project.', undefined, [
      'FOREMAN',
      'PREFERENCE',
      'EXISTING',
      'COMPANY',
    ]),
    field('stack.language', 'Language', 'Use FOREMAN if unsure.'),
    field('stack.framework', 'Framework', 'Use FOREMAN if unsure.'),
    field('stack.database', 'Database', 'Use FOREMAN if unsure.'),
    field('stack.cloud', 'Cloud', 'Use FOREMAN if unsure.'),
  ],
  [
    field(
      'services.selected',
      'Services the app will use',
      'One CATEGORY: Provider per line. Categories: BACKEND, AUTH, DATABASE, STORAGE, CLOUD, EMAIL, SMS, PAYMENTS, MAPS, AI, DOMAIN, MONITORING. Choices only; never keys.',
      'services',
    ),
    field(
      'services.decide',
      'Let the Foreman choose services',
      'Provider choices affect scope; credentials come after signing.',
      'boolean',
    ),
  ],
  [
    field(
      'timing.capMinor',
      'Total builder budget',
      'The agreed cap is split between milestones. Enter an amount such as 30.00.',
      'money',
    ),
    field('timing.currency', 'Budget currency', 'The currency of the builder allowance.', undefined, [
      'USD',
      'GBP',
      'EUR',
    ]),
    field('timing.deadline', 'Target deadline (UTC)', 'The Foreman cannot extend this target.', 'date'),
    field('timing.pace', 'Milestone pace', 'Choose fewer larger steps or frequent smaller ones.', undefined, [
      'FOREMAN',
      'FEWER',
      'FREQUENT',
    ]),
    field('timing.signoffName', 'Who signs off at handover?', 'A human confirms the final product works.'),
    field('timing.signoffEmail', 'Sign-off email', 'Used for the handover task; no messages sent in this demo.'),
  ],
  [
    field(
      'handover.repository',
      'Your GitHub repository',
      'owner/repository. The code belongs to you from the first commit. No token needed here.',
    ),
    field('handover.production', 'Your production host', 'Real keys go directly into your own hosting.', undefined, [
      'RENDER',
      'AWS',
      'GCP',
      'AZURE',
      'FOREMAN',
    ]),
    field('handover.domain', 'Custom domain', 'Enter a domain or None. Never registrar passwords.'),
    field('handover.licence', 'Code licence', 'Proprietary means you own the code.'),
    field('handover.maintainer', 'Who maintains it afterward?', 'Shapes the handover documentation.'),
    field(
      'handover.consent',
      'Allow assigned agents or human builders to build this',
      'Your repository is visible only to the assigned builder. This does not authorise a payment.',
      'boolean',
    ),
  ],
];
export const stepNames = [
  'The idea',
  'People and places',
  'Features',
  'Data',
  'Stack',
  'Services',
  'Budget and timing',
  'Ownership and handover',
];
export function majorToMinor(value: string): number {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) throw new Error('Enter an amount with no more than two decimal places.');
  const [whole = '', fraction = ''] = value.split('.');
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (minor < 3n || minor > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error('The budget is outside the supported range.');
  return Number(minor);
}
export function formValues(draft: IntakeDraft): IntakeValues {
  const values: IntakeValues = {};
  for (const group of formFields)
    for (const item of group) {
      const [step, name] = item.path.split('.') as [keyof IntakeDraft, string];
      const section = draft[step] as Record<string, unknown> | undefined;
      const value = section?.[name];
      if (value === undefined) continue;
      if (item.kind === 'money') {
        const amount = BigInt(value as number);
        values[item.path] = `${amount / 100n}.${String(amount % 100n).padStart(2, '0')}`;
      } else if (item.kind === 'date') values[item.path] = new Date(value as number).toISOString().slice(0, 16);
      else if (item.kind === 'services')
        values[item.path] = (value as { category: string; provider: string }[])
          .map((v) => `${v.category}: ${v.provider}`)
          .join('\n');
      else if (Array.isArray(value)) values[item.path] = value.join('\n');
      else values[item.path] = String(value);
    }
  return values;
}
export function formDraft(values: IntakeValues): IntakeDraft {
  assertPublicInput(values);
  const draft: Record<string, Record<string, unknown>> = {};
  for (const group of formFields)
    for (const item of group) {
      const raw = values[item.path];
      if (raw === undefined || (!raw.trim() && !['list', 'services'].includes(item.kind ?? ''))) continue;
      const [step, name] = item.path.split('.') as [string, string];
      let value: unknown = raw.trim();
      if (item.kind === 'money') value = majorToMinor(raw.trim());
      else if (item.kind === 'date') {
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) throw new Error('Choose a valid UTC deadline.');
        value = Date.parse(`${raw}:00Z`);
        if (!Number.isSafeInteger(value) || new Date(value as number).toISOString().slice(0, 16) !== raw)
          throw new Error('Choose a valid UTC deadline.');
      } else if (item.kind === 'boolean') {
        if (!['true', 'false'].includes(raw)) throw new Error('Choose yes or no.');
        value = raw === 'true';
      } else if (item.kind === 'list')
        value = raw
          .split('\n')
          .map((v) => v.trim())
          .filter(Boolean);
      else if (item.kind === 'services')
        value = raw
          .split('\n')
          .filter((v) => v.trim())
          .map((line) => {
            const match = /^([A-Z]+):\s*(.+)$/.exec(line.trim());
            if (!match) throw new Error('Use CATEGORY: Provider for each service.');
            return { category: match[1], provider: match[2] };
          });
      const section = draft[step] ?? {};
      section[name] = value;
      draft[step] = section;
    }
  return intakeChecked(draft);
}
// An explicit decision aid; never fabricates the idea, budget, owner or human sign-off.
export function foremanChoices(step: number): IntakeValues {
  const name = intakeSteps[step];
  if (name === 'idea')
    return {
      'idea.users': 'FOREMAN',
      'idea.proofFlow': 'Let the Foreman propose a proof flow',
      'idea.references': '',
      'idea.assets': '',
    };
  if (name === 'audience')
    return {
      'audience.platforms': 'FOREMAN',
      'audience.countries': 'FOREMAN',
      'audience.currencies': 'FOREMAN',
      'audience.languages': 'FOREMAN',
      'audience.usersMonth1': 'FOREMAN',
      'audience.usersMonth12': 'FOREMAN',
      'audience.accessibility': 'WCAG AA',
      'audience.offline': 'FOREMAN',
    };
  if (name === 'features') return { 'features.selected': 'FOREMAN', 'features.details': 'Let the Foreman decide' };
  if (name === 'data')
    return {
      'data.categories': 'FOREMAN',
      'data.personalData': 'FOREMAN',
      'data.regimes': 'FOREMAN',
      'data.residency': 'FOREMAN',
      'data.importSource': 'FOREMAN',
      'data.retention': 'FOREMAN',
    };
  if (name === 'stack') return Object.fromEntries((formFields[4] ?? []).map((f) => [f.path, 'FOREMAN']));
  if (name === 'services') return { 'services.selected': '', 'services.decide': 'true' };
  if (name === 'timing') return { 'timing.pace': 'FOREMAN' };
  return {
    'handover.production': 'FOREMAN',
    'handover.domain': 'None',
    'handover.licence': 'Proprietary',
    'handover.maintainer': 'Me',
  };
}
