// A live qualification claim requires matching provider-backed facts, not a passing runner report or a Yard label.
type Expected = Readonly<{ trancheId: string; packageId: string; minor: number; currency: string }>;
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
export function existingYardMandate(value: unknown): Record<string, unknown> | null {
  const mandate = object(value);
  if (mandate.status !== 'CREATED') return null;
  if (
    typeof mandate.allowanceId !== 'string' ||
    !mandate.allowanceId.startsWith('alw_') ||
    typeof object(mandate.tranches).final !== 'string' ||
    !String(object(mandate.tranches).final).startsWith('trn_')
  )
    throw new Error('Yard mandate recording is incomplete');
  return mandate;
}
export function qualifiedYardPayment(expected: Expected, stoodValue: unknown, yardValue: unknown): boolean {
  const stood = object(stoodValue),
    yard = object(yardValue);
  const settlement = object(stood.settlement),
    payment = object(yard.payment),
    amount = object(stood.amount);
  return (
    stood.provider === 'paypal-sandbox' &&
    stood.id === expected.trancheId &&
    stood.package_id === expected.packageId &&
    stood.state === 'RELEASED' &&
    settlement.effect === 'CAPTURE' &&
    typeof settlement.reference === 'string' &&
    settlement.reference.length > 0 &&
    amount.minor === expected.minor &&
    amount.currency === expected.currency &&
    yard.state === 'PAID' &&
    payment.effect === 'CAPTURE' &&
    payment.trancheId === expected.trancheId &&
    payment.packageId === expected.packageId &&
    payment.reference === settlement.reference &&
    payment.minor === expected.minor &&
    payment.currency === expected.currency &&
    object(object(yard.usage).forwarded).status === 'ACCEPTED'
  );
}
