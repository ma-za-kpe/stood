import { expect, it } from 'vitest';
import { researchBrief } from './research-brief.js';

const row = {
  title: 'Kenyan coffee',
  slug: 'kenyan-coffee',
  problem_statement: 'No local access',
  target_customer: 'Nairobi professionals',
  catalog_decision: 'rejected' as const,
  catalog_caveat: 'A founder_fit tribunal veto prevents this report from being sold.',
  catalog_reason_codes: ['tribunal_veto'],
  url: 'https://startuptribunal.com/catalog/kenyan-coffee',
  blueprint_url: 'https://startuptribunal.com/catalog/kenyan-coffee',
};
it('starts a bounded reviewed summary without inventing planning or payment authority', () => {
  const brief = researchBrief({ ...row, problem_statement: 'x'.repeat(4096) });
  expect(brief.idea?.description?.length).toBeLessThanOrEqual(4096);
  expect(brief.idea?.description).toContain(row.catalog_caveat);
  expect(brief.idea?.description).toContain('tribunal_veto');
  expect(brief.idea?.description).toContain('catalog summary');
  expect(brief.idea?.users).toEqual(['Nairobi professionals']);
  expect(brief.timing).toBeUndefined();
  expect(brief.handover).toBeUndefined();
});
it('discloses absent caveats/customers and retains source safety checks', () => {
  const brief = researchBrief({ ...row, target_customer: null, catalog_caveat: null });
  expect(brief.idea?.description).toContain('No caveat supplied.');
  expect(brief.idea?.users).toBeUndefined();
  expect(() => researchBrief({ ...row, problem_statement: 'api_key: sk_test_do_not_store_this' })).toThrow();
});
