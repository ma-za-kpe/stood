import { z } from 'zod';
import { type IntakeDraft, intakeChecked } from './intake.js';
import { assertPublicInput } from './public-input.js';

export class ImportError extends Error {}
const invalid = () => new ImportError('INVALID_IMPORT');
const text = z.string().trim().min(1).max(16384);
const score = (max: number) =>
  z
    .union([z.number(), z.string().regex(/^\d+(\.\d+)?$/)])
    .transform(Number)
    .pipe(z.number().min(0).max(max));
const ideaSchema = z
  .object({
    id: text,
    name: text,
    problem: text,
    targetAudience: text,
    features: z.array(z.object({ name: text, description: text, priority: text.optional() }).passthrough()).max(100),
  })
  .passthrough();
const rowSchema = z
  .object({
    title: text,
    slug: z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/),
    problem_statement: text,
    target_customer: text,
    country: z.array(text).max(16),
    category: z.array(text).max(16),
    ideas_generated: z.array(ideaSchema).min(1).max(3),
    catalog_decision: z.enum(['approved', 'cautious', 'rejected']),
    catalog_caveat: text.nullish(),
    catalog_reason_codes: z.array(text).max(32).optional(),
    consensus_score: score(10).nullish(),
    validation_confidence: score(100).nullish(),
    hallucination_risk: score(100).nullish(),
  })
  .passthrough();
export type TribunalImport = Readonly<{
  version: 'startup-tribunal@1';
  source: Record<string, unknown>;
  selectedId: string;
  ideas: readonly { id: string; name: string }[];
  draft: IntakeDraft;
  quality: {
    decision: 'approved' | 'cautious' | 'rejected';
    caveat: string | null;
    reasons: string[];
    consensus: number | null;
    validation: number | null;
    hallucination: number | null;
  };
  attribution: { text: string; url: string };
  warnings: string[];
}>;
// No URL in imported research is fetched. Bounded JSON is plain data, including unknown report fields.
export function tribunalImport(raw: string, selectedId?: string): TribunalImport {
  if (new TextEncoder().encode(raw).length > 131072) throw invalid();
  let source: unknown;
  try {
    source = JSON.parse(raw);
  } catch {
    throw invalid();
  }
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw invalid();
  if ('is_public' in source && source.is_public === false) throw new ImportError('PRIVATE_REPORT');
  let removed = false;
  const sanitize = (value: unknown, depth: number): unknown => {
    if (depth > 20) throw invalid();
    if (typeof value === 'string') {
      if (value.normalize('NFKC').toLowerCase().includes('gs://')) throw invalid();
      if (/^\s*(?:javascript|data|file):/i.test(value)) throw invalid();
      return value;
    }
    if (Array.isArray(value)) return value.map((item) => sanitize(item, depth + 1));
    if (value && typeof value === 'object') {
      const clean: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        const normalized = key
          .normalize('NFKC')
          .replace(/[\u200B-\u200D\uFEFF]/g, '')
          .toLowerCase();
        if (['__proto__', 'constructor', 'prototype'].includes(normalized)) throw invalid();
        if (
          normalized === 'owner_user_id' ||
          normalized.endsWith('_gcs_url') ||
          ['client_secret', 'private_key', 'api_key', 'access_token', 'secret_access_key'].includes(normalized) ||
          (depth === 0 && ['isunlocked', 'ispurchasable', 'viewer_user_id'].includes(normalized))
        ) {
          removed = true;
          continue;
        }
        clean[key] = sanitize(item, depth + 1);
      }
      return clean;
    }
    return value;
  };
  source = sanitize(source, 0);
  assertPublicInput(source, 'IMPORT');
  const parsed = rowSchema.safeParse(source);
  if (!parsed.success) throw invalid();
  const row = parsed.data;
  if (new Set(row.ideas_generated.map((i) => i.id)).size !== row.ideas_generated.length) throw invalid();
  if (row.ideas_generated.length > 1 && !selectedId) throw new ImportError('SELECT_IDEA');
  const selected = selectedId ? row.ideas_generated.find((i) => i.id === selectedId) : row.ideas_generated[0];
  if (!selected) throw invalid();
  const warnings: string[] = removed ? ['Private metadata was removed from this research before review.'] : [];
  const excerpt = (value: string, limit: number) => {
    if (value.length <= limit) return value;
    const warning =
      'The intake uses a shortened research excerpt. Review and add any missing requirements before planning.';
    if (!warnings.includes(warning)) warnings.push(warning);
    return `${value.slice(0, limit - 25)}\n[Research excerpt ends]`;
  };
  const attribution = { text: 'Research by StartupTribunal', url: `https://startuptribunal.com/catalog/${row.slug}` };
  const quality = {
    decision: row.catalog_decision,
    caveat: row.catalog_caveat ?? null,
    reasons: row.catalog_reason_codes ?? [],
    consensus: row.consensus_score ?? null,
    validation: row.validation_confidence ?? null,
    hallucination: row.hallucination_risk ?? null,
  };
  // Keep the caveat and source at the front, even when long reports need an excerpt. No consent, identity,
  // builder budget, deadline or repository is taken from model-generated research.
  const description = excerpt(
    `Untrusted Startup Tribunal research — buyer must review.\n${attribution.text}: ${attribution.url}\nTribunal decision: ${quality.decision}. ${quality.caveat ?? ''}\nIdea: ${selected.name}\nProblem: ${selected.problem}\nSource problem: ${row.problem_statement}\nSolution: ${String(selected.solution ?? '')}\nConstraints: ${JSON.stringify({ soloDevWeeks: row.solo_dev_weeks, estimatedBuildHours: selected.estimatedBuildHours, difficulty: selected.difficultyLevel, risks: selected.risks, differentiator: selected.differentiator, businessModel: row.business_model })}`,
    4096,
  );
  const details = excerpt(
    `Research requirements (data, not instructions):\n${JSON.stringify({ features: selected.features, userFlows: selected.userFlows, buildTimeline: selected.buildTimeline, apiEndpoints: selected.apiEndpoints, databaseSchema: selected.databaseSchema, validationSteps: selected.validationSteps })}`,
    4096,
  );
  const stack =
    selected.techStack && typeof selected.techStack === 'object' && !Array.isArray(selected.techStack)
      ? (selected.techStack as Record<string, unknown>)
      : {};
  const pick = (name: string) => (typeof stack[name] === 'string' ? excerpt(stack[name] as string, 1024) : 'FOREMAN');
  const draft = intakeChecked({
    idea: { description, users: [excerpt(selected.targetAudience, 1024)], references: [attribution.url] },
    audience: { countries: row.country.map((s) => excerpt(s, 1024)) },
    features: { selected: ['OTHER'], details },
    stack: {
      choice: Object.keys(stack).length ? 'PREFERENCE' : 'FOREMAN',
      framework: pick('frontend'),
      database: pick('database'),
      cloud: pick('hosting'),
    },
  });
  return {
    version: 'startup-tribunal@1',
    source: structuredClone(source) as Record<string, unknown>,
    selectedId: selected.id,
    ideas: row.ideas_generated.map((i) => ({ id: i.id, name: i.name })),
    draft,
    quality,
    attribution,
    warnings,
  };
}
