// Y19 §3: providers whose TEST/DEV credentials Yard may hold for previews. GitHub and Render are
// reached through their own app/workspace, never through pasted buyer keys.
export const SECRET_PROVIDERS: readonly string[] = Object.freeze([
  'supabase',
  'firebase',
  'gcp',
  'aws',
  'azure',
  'paypal',
  'stripe',
  'paystack',
  'flutterwave',
  'resend',
  'postmark',
  'sendgrid',
  'twilio',
  'africastalking',
  'termii',
  'openai',
  'anthropic',
  'mapbox',
  'sentry',
]);
export const SECRET_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;
export type SecretInput = Readonly<{ name: string; provider: string; environment: 'TEST' | 'DEV'; value: string }>;
// Client-side shape check only. The server decides, and refuses live keys.
export function secretInputProblem(input: SecretInput): 'NAME' | 'PROVIDER' | 'ENVIRONMENT' | 'VALUE' | null {
  if (!SECRET_NAME.test(input.name)) return 'NAME';
  if (!SECRET_PROVIDERS.includes(input.provider)) return 'PROVIDER';
  if (input.environment !== 'TEST' && input.environment !== 'DEV') return 'ENVIRONMENT';
  if (!input.value.trim() || input.value.length > 8192) return 'VALUE';
  return null;
}
