import { z } from 'zod';
import { assertPublicInput, IntakeError } from './public-input.js';

const text = z.string().trim().min(1).max(1024);
const longText = z.string().trim().min(1).max(4096);
const words = z.array(text).max(16);
const url = z
  .url()
  .max(2048)
  .refine((v) => {
    const parsed = new URL(v);
    return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password;
  });
const choice = z.enum(['FOREMAN', 'YES', 'NO']);
const idea = z.strictObject({
  description: longText,
  users: words,
  proofFlow: text,
  references: z.array(url).max(10),
  assets: z.array(url).max(10),
});
const audience = z.strictObject({
  platforms: z.array(z.enum(['WEB', 'PWA', 'IOS', 'ANDROID', 'API', 'FOREMAN'])).max(6),
  countries: words,
  currencies: words,
  languages: words,
  usersMonth1: z.enum(['FOREMAN', 'UNDER_100', 'UNDER_1000', 'UNDER_10000', 'MORE']),
  usersMonth12: z.enum(['FOREMAN', 'UNDER_100', 'UNDER_1000', 'UNDER_10000', 'MORE']),
  accessibility: words,
  offline: choice,
});
const features = z.strictObject({
  selected: z
    .array(
      z.enum([
        'AUTH',
        'PAYMENTS',
        'BOOKINGS',
        'NOTIFICATIONS',
        'UPLOADS',
        'ADMIN',
        'SEARCH',
        'MAPS',
        'AI',
        'ANALYTICS',
        'OTHER',
        'FOREMAN',
      ]),
    )
    .max(12),
  details: longText,
});
const data = z.strictObject({
  categories: words,
  personalData: choice,
  regimes: words,
  residency: words,
  importSource: text,
  retention: text,
});
const stack = z.strictObject({
  choice: z.enum(['FOREMAN', 'PREFERENCE', 'EXISTING', 'COMPANY']),
  language: text,
  framework: text,
  database: text,
  cloud: text,
});
const services = z.strictObject({
  selected: z
    .array(
      z.strictObject({
        category: z.enum([
          'BACKEND',
          'AUTH',
          'DATABASE',
          'STORAGE',
          'CLOUD',
          'EMAIL',
          'SMS',
          'PAYMENTS',
          'MAPS',
          'AI',
          'DOMAIN',
          'MONITORING',
        ]),
        provider: text,
      }),
    )
    .max(24),
  decide: z.boolean(),
});
const timing = z.strictObject({
  capMinor: z.number().int().min(3).max(Number.MAX_SAFE_INTEGER),
  currency: z.enum(['USD', 'GBP', 'EUR']),
  deadline: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  pace: z.enum(['FOREMAN', 'FEWER', 'FREQUENT']),
  signoffName: text,
  signoffEmail: z.email().max(254),
});
const handover = z.strictObject({
  repository: z
    .string()
    .regex(/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/)
    .max(200),
  baseCommit: z.string().regex(/^[a-f0-9]{40}$/),
  production: z.enum(['RENDER', 'AWS', 'GCP', 'AZURE', 'FOREMAN']),
  domain: text,
  licence: text,
  maintainer: text,
  consent: z.boolean(),
});
export const intakeFields = { idea, audience, features, data, stack, services, timing, handover } as const;
export const intakeSteps = ['idea', 'audience', 'features', 'data', 'stack', 'services', 'timing', 'handover'] as const;
export type IntakeStep = (typeof intakeSteps)[number];
export const intakeDraftSchema = z.strictObject({
  idea: idea.partial().optional(),
  audience: audience.partial().optional(),
  features: features.partial().optional(),
  data: data.partial().optional(),
  stack: stack.partial().optional(),
  services: services.partial().optional(),
  timing: timing.partial().optional(),
  handover: handover.partial().optional(),
});
export type IntakeDraft = z.infer<typeof intakeDraftSchema>;
export const completeIntakeSchema = z
  .strictObject(intakeFields)
  .refine((v) => v.handover.consent && v.idea.users.length > 0);
export type CompleteIntake = z.infer<typeof completeIntakeSchema>;
export function intakeChecked(value: unknown): IntakeDraft {
  assertPublicInput(value);
  const parsed = intakeDraftSchema.safeParse(value);
  if (!parsed.success) throw new IntakeError('INVALID_INTAKE');
  return structuredClone(parsed.data);
}
export function completeIntakeChecked(value: unknown, now: number): CompleteIntake {
  assertPublicInput(value);
  const parsed = completeIntakeSchema.safeParse(value);
  if (!parsed.success || !Number.isSafeInteger(now) || now < 0 || parsed.data.timing.deadline <= now)
    throw new IntakeError('INVALID_INTAKE');
  return structuredClone(parsed.data);
}
