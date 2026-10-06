import { expect, it } from 'vitest';
import { type CompleteIntake, intakeFields } from './intake.js';
import { BUILDER_CONSENT, INTAKE_DATA_CLASSES, withheldForPlanner } from './privacy.js';

it('classifies every intake answer, and keeps personal answers buyer-only (T-0217)', () => {
  const paths = Object.entries(intakeFields).flatMap(([step, schema]) =>
    Object.keys(schema.shape).map((field) => `${step}.${field}`),
  );
  expect(Object.keys(INTAKE_DATA_CLASSES).sort()).toEqual(paths.sort());
  const personal = Object.entries(INTAKE_DATA_CLASSES).filter(([, [kind]]) => kind === 'PERSONAL');
  expect(personal.map(([path]) => path).sort()).toEqual([
    'handover.maintainer',
    'timing.signoffEmail',
    'timing.signoffName',
  ]);
  expect(personal.every(([, [, audience]]) => audience === 'BUYER_ONLY')).toBe(true);
});

it('tells people and agent operators what Yard keeps, in plain words', () => {
  for (const text of Object.values(BUILDER_CONSENT)) {
    expect(text).toContain('payee reference');
    expect(text).not.toMatch(/leverage|seamless|robust/i);
  }
  expect(BUILDER_CONSENT.AGENT).toContain('90 days');
});

it('withholds every personal answer from the planner, keeping the intake valid', () => {
  const personal = { signoffName: 'Adaeze Okafor', signoffEmail: 'adaeze@example.com', maintainer: 'Adaeze Okafor' };
  const intake = {
    timing: { capMinor: 1000, signoffName: personal.signoffName, signoffEmail: personal.signoffEmail },
    handover: { repository: 'a/b', maintainer: personal.maintainer },
  } as unknown as CompleteIntake;
  const withheld = withheldForPlanner(intake);
  const text = JSON.stringify(withheld);
  for (const value of Object.values(personal)) expect(text).not.toContain(value);
  for (const [path, [kind]] of Object.entries(INTAKE_DATA_CLASSES)) {
    const [step, field] = path.split('.') as [keyof CompleteIntake, string];
    if (kind === 'PERSONAL') expect((withheld[step] as Record<string, unknown>)[field]).toMatch(/withheld/);
  }
  expect(withheld.timing.capMinor).toBe(1000);
  expect(intakeFields.timing.shape.signoffEmail.safeParse(withheld.timing.signoffEmail).success).toBe(true);
});
