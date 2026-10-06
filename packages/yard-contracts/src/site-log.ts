import { z } from 'zod';
import { assertPublicInput } from './public-input.js';

const message = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine(
    (v) =>
      v.split('\n').length <= 20 &&
      !/[<>]/.test(v) &&
      [...v].every((ch) => {
        const n = ch.charCodeAt(0);
        return (n >= 32 && n !== 127) || n === 9 || n === 10 || n === 13;
      }),
  );
const simpleKinds = ['plan', 'edit', 'punch_list_received', 'clock_out', 'note'] as const;
const line = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.enum(simpleKinds), message }),
  z.strictObject({
    kind: z.literal('test_run'),
    message,
    data: z
      .strictObject({
        passed: z.number().int().min(0).max(100000),
        total: z.number().int().min(1).max(100000),
      })
      .refine((v) => v.passed <= v.total),
  }),
  z.strictObject({
    kind: z.enum(['commit', 'submit']),
    message,
    data: z.strictObject({ sha: z.string().regex(/^[a-f0-9]{40}$/) }),
  }),
]);
const batch = z.strictObject({ lines: z.array(line).min(1).max(20) });
export type SiteLogLine = z.infer<typeof line>;
export function siteLogBatchChecked(value: unknown): readonly SiteLogLine[] {
  assertPublicInput(value);
  return batch.parse(value).lines;
}
