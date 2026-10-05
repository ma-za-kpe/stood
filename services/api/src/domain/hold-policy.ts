// Stood's operational buffer, not a provider guarantee. Recheck before the external call.
export const CAPTURE_SAFETY_MARGIN_MS = 5 * 60 * 1000;
const holdCurrencies: ReadonlySet<string> = new Set(['GBP', 'USD', 'EUR']);

export function assertHoldCurrency(currency: string): void {
  if (!holdCurrencies.has(currency)) throw new RangeError('Unsupported hold currency');
}

export function captureAllowedAt(expiresAt: number, now: number): boolean {
  return Number.isFinite(expiresAt) && Number.isFinite(now) && now < expiresAt - CAPTURE_SAFETY_MARGIN_MS;
}
