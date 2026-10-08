export const PAYMENT_KEYS = [
  'PAYPAL_CLIENT_ID',
  'PAYPAL_CLIENT_SECRET',
  'PAYPAL_WEBHOOK_ID',
  'STOOD_API_KEY',
  'STOOD_HMAC_SECRET',
  'STOOD_WEBHOOK_SECRET',
] as const;
export type PaymentKeys = Readonly<Partial<Record<(typeof PAYMENT_KEYS)[number], string>>>;
export const SETUP_GUIDANCE =
  'Payments are off: run scripts/dev setup for sandbox keys; see docs/USAGE.md#keys-and-configuration. Payment adapter qualification is still required.';
export function missingPaymentKeys(keys: PaymentKeys = {}): readonly string[] {
  return PAYMENT_KEYS.filter((key) => !keys[key]?.trim());
}
// Every key present is not the same as qualified: payments stay off until the sandbox adapter passes qualification (T-0121).
export const QUALIFICATION_GUIDANCE =
  'Payments are off: the sandbox keys are set, but the PayPal sandbox adapter has not passed qualification yet. See docs/SETUP.md.';
export function paymentGuidance(keys: PaymentKeys = {}): Readonly<{ code: string; title: string; detail: string }> {
  return missingPaymentKeys(keys).length
    ? { code: 'payments_not_configured', title: 'Payments not configured', detail: SETUP_GUIDANCE }
    : { code: 'payments_not_qualified', title: 'Payments not qualified', detail: QUALIFICATION_GUIDANCE };
}
