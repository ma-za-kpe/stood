const SANDBOX = 'https://api-m.sandbox.paypal.com';
const HEADERS = {
  transmission_id: 'paypal-transmission-id',
  transmission_time: 'paypal-transmission-time',
  transmission_sig: 'paypal-transmission-sig',
  cert_url: 'paypal-cert-url',
  auth_algo: 'paypal-auth-algo',
} as const;

// Verifies inbound PayPal webhooks with PayPal's own verify-webhook-signature API (T-0033).
// A true result only says PayPal sent this notification; settlement still needs provider proof.
export class PayPalWebhookVerifier {
  private token: Readonly<{ value: string; expiresAt: number }> | null = null;
  constructor(
    private readonly config: Readonly<{
      baseUrl: string;
      clientId: string;
      clientSecret: string;
      webhookId: string;
      transport: (request: Request) => Promise<Response>;
      clock: () => number;
    }>,
  ) {
    if (
      config.baseUrl !== SANDBOX ||
      !config.clientId.trim() ||
      !config.clientSecret.trim() ||
      !config.webhookId.trim()
    )
      throw new Error('Sandbox webhook verification not configured');
  }

  async verify(raw: string, headers: Headers): Promise<boolean> {
    const delivery: Record<string, string> = {};
    for (const [field, header] of Object.entries(HEADERS)) {
      const value = headers.get(header)?.trim();
      if (!value || value.length > 2048) return false;
      delivery[field] = value;
    }
    if (!trustedCertificate(delivery.cert_url ?? '')) return false;
    let event: unknown;
    try {
      event = JSON.parse(raw);
    } catch {
      return false;
    }
    const response = await this.config.transport(
      new Request(`${SANDBOX}/v1/notifications/verify-webhook-signature`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await this.accessToken()}`,
          'Content-Type': 'application/json',
          'PayPal-Request-Id': `verify-${delivery.transmission_id}`,
        },
        body: JSON.stringify({ ...delivery, webhook_id: this.config.webhookId, webhook_event: event }),
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
      }),
    );
    const body = (await response.json().catch(() => ({}))) as { verification_status?: unknown; debug_id?: unknown };
    if (!response.ok) throw new Error(unavailable('verification', response.status, body.debug_id));
    return body.verification_status === 'SUCCESS';
  }

  private async accessToken(): Promise<string> {
    const now = this.config.clock();
    if (this.token && now < this.token.expiresAt) return this.token.value;
    const response = await this.config.transport(
      new Request(`${SANDBOX}/v1/oauth2/token`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`${this.config.clientId}:${this.config.clientSecret}`)}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
      }),
    );
    const body = (await response.json().catch(() => ({}))) as {
      access_token?: unknown;
      expires_in?: unknown;
      debug_id?: unknown;
    };
    if (!response.ok || typeof body.access_token !== 'string' || typeof body.expires_in !== 'number')
      throw new Error(unavailable('token', response.status, body.debug_id));
    // Refresh a minute early so a token never expires mid-request.
    this.token = { value: body.access_token, expiresAt: now + Math.max(0, body.expires_in - 60) * 1000 };
    return this.token.value;
  }
}

function trustedCertificate(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (u.hostname === 'paypal.com' || u.hostname.endsWith('.paypal.com'));
  } catch {
    return false;
  }
}

function unavailable(step: string, status: number, debugId: unknown): string {
  return `PayPal ${step} unavailable (HTTP ${status}, debug id ${typeof debugId === 'string' ? debugId : 'none'})`;
}
