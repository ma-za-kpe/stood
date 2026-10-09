import { type Catalog, intakeChecked } from '@stood/yard-contracts';

// Discovery rows are summaries, never full imported reports or permission to start a build.
export function researchBrief(item: Catalog['items'][number]) {
  return intakeChecked({
    idea: {
      description:
        `StartupTribunal catalog summary — review the full research before planning.\nResearch by StartupTribunal: ${item.url}\nTribunal decision: ${item.catalog_decision}. ${item.catalog_caveat ?? 'No caveat supplied.'}\nReason codes: ${item.catalog_reason_codes.join(', ')}\n${item.title}\n${item.problem_statement}`.slice(
          0,
          4096,
        ),
      references: [item.url],
      ...(item.target_customer ? { users: [item.target_customer.slice(0, 1024)] } : {}),
    },
  });
}
