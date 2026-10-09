import { z } from 'zod';

const link = z
  .url()
  .max(2048)
  .refine((value) => {
    const url = new URL(value);
    return (
      url.origin === 'https://startuptribunal.com' &&
      !url.username &&
      !url.password &&
      /^\/catalog(?:\/|$)/.test(url.pathname)
    );
  });
const text = z.string().trim().min(1).max(4096);
const item = z.object({
  title: text,
  slug: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/),
  problem_statement: text,
  target_customer: text.nullable(),
  catalog_decision: z.literal('rejected'),
  catalog_caveat: text.nullable(),
  catalog_reason_codes: z.array(text).max(32),
  url: link,
  blueprint_url: link,
  // T-0282: display facts for the idea cards, when the source supplies them (ISO country codes, category slugs).
  country: z
    .array(z.string().regex(/^[A-Z]{2}$/))
    .max(8)
    .default([]),
  category: z
    .array(
      z
        .string()
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
        .max(40),
    )
    .max(8)
    .default([]),
  consensus_score: z.number().min(0).max(10).nullable().default(null),
});
export const catalogSchema = z.object({
  items: z.array(item).max(10),
  attribution: z.object({
    required: z.literal(true),
    text: z.literal('Research by StartupTribunal'),
    url: z.literal('https://startuptribunal.com/catalog'),
  }),
});
export type Catalog = z.infer<typeof catalogSchema>;
