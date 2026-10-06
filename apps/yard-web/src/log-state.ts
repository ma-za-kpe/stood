import { type SiteLogLine, siteLogBatchChecked } from '@stood/yard-contracts';
import { z } from 'zod';

const kinds = ['plan', 'edit', 'test_run', 'commit', 'submit', 'punch_list_received', 'clock_out', 'note'];
const iso = z.string().refine((v) => {
  const time = Date.parse(v);
  return Number.isFinite(time) && new Date(time).toISOString() === v;
});
const entry = z.strictObject({
  seq: z.number().int().positive(),
  actor: z.string().min(1).max(100),
  at: iso,
  line: z.unknown().transform((v) => siteLogBatchChecked({ lines: [v] })[0]!),
});
const summary = z
  .strictObject({
    through: z.number().int().positive(),
    count: z.number().int().positive(),
    kinds: z.record(z.string(), z.number().int().positive()),
  })
  .refine(
    (v) =>
      Object.keys(v.kinds).every((k) => kinds.includes(k)) &&
      Object.values(v.kinds).reduce((sum, n) => sum + n, 0) === v.count,
  );
const snapshot = z
  .strictObject({
    version: z.number().int().nonnegative(),
    retainedFrom: z.number().int().positive(),
    lines: z.array(entry).max(200),
    summary: summary.nullable(),
  })
  .refine(
    (v) =>
      v.retainedFrom <= v.version + 1 &&
      (v.summary?.through ?? 0) < v.retainedFrom &&
      (v.lines.length
        ? v.lines.every((l, i) => l.seq === v.retainedFrom + i) && v.lines.at(-1)!.seq === v.version
        : v.retainedFrom === v.version + 1 && (v.summary?.through ?? 0) === v.version),
  );
export type LogView = z.infer<typeof snapshot>;
export function logChecked(value: unknown): LogView {
  return snapshot.parse(value);
}
export function applyLogEvent(view: LogView, event: unknown): LogView | 'GAP' {
  const result = z
    .strictObject({
      seq: z.number().int().positive(),
      actor: z.string(),
      at: iso,
      type: z.literal('site_log.line'),
      payload: z.unknown(),
    })
    .safeParse(event);
  if (!result.success) return 'GAP';
  const e = result.data;
  if (e.seq <= view.version) return view;
  if (e.seq !== view.version + 1) return 'GAP';
  let line: SiteLogLine;
  try {
    line = siteLogBatchChecked({ lines: [e.payload] })[0]!;
  } catch {
    return 'GAP';
  }
  const lines = [...view.lines, { seq: e.seq, actor: e.actor, at: e.at, line }].slice(-200);
  return { ...view, version: e.seq, retainedFrom: lines[0]!.seq, lines };
}
