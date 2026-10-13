import type { StoredDraft } from '../ports/platform-api-store.js';
import { allowanceDraft } from './allowance-draft.js';
import { canonicalMandate } from './mandate-terms.js';

// This first amendment boundary changes evidence terms for unfunded work only. Persistence must supply the
// reserved tranche identities under the same locks as funding and retain both complete version snapshots.
export function allowanceAmendment(
  current: StoredDraft,
  value: unknown,
  reservedTranches: ReadonlySet<string>,
): StoredDraft {
  const proposed = allowanceDraft(value);
  if (
    proposed.payee_ref !== current.payee_ref ||
    canonicalMandate(proposed.cap) !== canonicalMandate(current.cap) ||
    proposed.window_days !== current.window_days ||
    proposed.max_resubmits !== current.max_resubmits ||
    proposed.milestones.length !== current.milestones.length ||
    current.tranches.length !== current.milestones.length
  )
    throw new RangeError('Amendment changes financial boundaries');
  let changed = false;
  proposed.milestones.forEach((milestone, index) => {
    const prior = current.milestones[index]!;
    const tranche = current.tranches[index]!;
    if (
      milestone.name !== prior.name ||
      milestone.profile !== prior.profile ||
      canonicalMandate(milestone.amount) !== canonicalMandate(prior.amount)
    )
      throw new RangeError('Amendment changes milestone identity or amount');
    if (canonicalMandate(milestone.params) !== canonicalMandate(prior.params)) {
      if (reservedTranches.has(tranche.id)) throw new RangeError('Amendment changes funded work');
      changed = true;
    }
  });
  if (!changed) throw new RangeError('Amendment must change evidence terms');
  return structuredClone({ ...current, ...proposed });
}
