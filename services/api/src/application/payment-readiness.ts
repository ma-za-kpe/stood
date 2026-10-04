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
