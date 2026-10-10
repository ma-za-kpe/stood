import { Allowance } from '../domain/allowance.js';
import { Money } from '../domain/money.js';
import type { DraftInput } from '../ports/platform-api-store.js';
import { codeTerms } from './code-terms.js';

function object(value: unknown, keys?: readonly string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (keys && Object.keys(value).some((key) => !keys.includes(key)))
  )
    throw new RangeError('Invalid draft object');
  return value as Record<string, unknown>;
}
function text(value: unknown, limit: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) throw new RangeError('Invalid draft text');
  return value.trim();
}
function money(value: unknown): Money {
  const v = object(value, ['minor', 'currency']);
  if (typeof v.minor !== 'number' || !Number.isSafeInteger(v.minor) || typeof v.currency !== 'string')
    throw new RangeError('Invalid draft money');
  return new Money(BigInt(v.minor), v.currency);
}
export function allowanceDraft(value: unknown): DraftInput {
  const v = object(value, ['payee_ref', 'cap', 'milestones', 'window_days', 'max_resubmits']);
  if (
    !Array.isArray(v.milestones) ||
    v.milestones.length > 50 ||
    typeof v.window_days !== 'number' ||
    typeof v.max_resubmits !== 'number'
  )
    throw new RangeError('Invalid draft limits');
  const milestones = v.milestones.map((raw: unknown) => {
    const m = object(raw, ['name', 'amount', 'profile', 'params']);
    const profileId = text(m.profile, 100);
    return {
      name: text(m.name, 100),
      amount: money(m.amount),
      profileId,
      // T-0159: a code milestone binds the runner and verifier to the terms signed here, so they must hold together.
      params: profileId.startsWith('code.') ? { ...codeTerms(m.params) } : object(m.params ?? {}),
    };
  });
  const draft = new Allowance({
    id: 'draft_validation',
    platformId: 'authenticated_platform',
    payeeRef: text(v.payee_ref, 200),
    cap: money(v.cap),
    milestones,
    windowDays: v.window_days,
    maxResubmits: v.max_resubmits,
  });
  return Object.freeze({
    payee_ref: draft.payeeRef,
    cap: draft.cap.toJSON(),
    milestones: Object.freeze(
      milestones.map((m) =>
        Object.freeze({
          name: m.name,
          amount: m.amount.toJSON(),
          profile: m.profileId,
          params: structuredClone(m.params),
        }),
      ),
    ),
    window_days: draft.windowDays,
    max_resubmits: draft.maxResubmits,
  });
}
