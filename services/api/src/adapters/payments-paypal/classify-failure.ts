import type { SettlementFailure } from '../../domain/tranche.js';

export type PaymentAction = 'CAPTURE' | 'VOID' | 'REAUTHORIZE';
type Classification = Readonly<{ kind: SettlementFailure['kind']; reference: string | null }>;
const ambiguous: Classification = Object.freeze({ kind: 'AMBIGUOUS', reference: null });
const issues: Readonly<Record<PaymentAction, Readonly<Record<string, SettlementFailure['kind']>>>> = {
  CAPTURE: { AUTHORIZATION_EXPIRED: 'AUTHORIZATION_EXPIRED', MAX_CAPTURE_AMOUNT_EXCEEDED: 'REJECTED_NO_PAYMENT' },
  VOID: {},
  REAUTHORIZE: { AUTH_CURRENCY_MISMATCH: 'REJECTED_NO_PAYMENT', REAUTHORIZATION_TOO_SOON: 'REJECTED_NO_PAYMENT' },
};
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim();

// Pure classification of an authenticated, operation-correlated response; no SDK or payment calls.
export function classifyPaymentFailure(action: PaymentAction, status: number | null, body: unknown): Classification {
  if (!Object.hasOwn(issues, action) || !record(body)) return ambiguous;
  if (action === 'CAPTURE' && (status === 200 || status === 201) && body.status === 'DECLINED' && text(body.id))
    return Object.freeze({ kind: 'DECLINED', reference: body.id });
  if (
    status !== 422 ||
    body.name !== 'UNPROCESSABLE_ENTITY' ||
    !text(body.message) ||
    !text(body.debug_id) ||
    !Array.isArray(body.details) ||
    !body.details.length
  )
    return ambiguous;
  const kinds = body.details.map((detail) =>
    record(detail) && text(detail.issue) && Object.hasOwn(issues[action], detail.issue)
      ? issues[action][detail.issue]
      : undefined,
  );
  const kind = kinds[0];
  if (!kind || kinds.some((candidate) => candidate !== kind)) return ambiguous;
  return Object.freeze({ kind, reference: body.debug_id });
}
