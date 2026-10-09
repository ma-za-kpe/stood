// The slice of a Playwright page the approval needs; the CLI connects a real one over CDP.
export type ApprovalPage = Readonly<{
  goto(url: string): Promise<unknown>;
  waitForSelector(selector: string, options?: { timeout?: number }): Promise<unknown>;
  isVisible(selector: string): Promise<boolean>;
  fill(selector: string, value: string): Promise<void>;
  click(selector: string): Promise<void>;
  url(): string;
  waitForURL(test: (url: URL) => boolean, options?: { timeout?: number }): Promise<void>;
}>;
type Config = Readonly<{
  apiKey: string;
  buyerEmail: string;
  buyerPassword: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  connect?: (cdpUrl: string) => Promise<Readonly<{ page: ApprovalPage; close(): Promise<void> }>>;
}>;
const APPROVE = '#payment-submit-btn, button:has-text("Agree & Continue")';

// C3: approves a PayPal SANDBOX link as the sandbox buyer in a Kernel cloud browser, so every sandbox outcome can
// be replayed without a person at the keyboard. It opens nothing but www.sandbox.paypal.com, never logs the
// buyer's password, and always ends the cloud browser (which also times out on its own).
export class KernelSandboxApprover {
  private readonly http: typeof globalThis.fetch;
  private readonly base: string;
  constructor(private readonly config: Config) {
    if (![config.apiKey, config.buyerEmail, config.buyerPassword].every((v) => v.trim()))
      throw new RangeError('Kernel approval needs KERNEL_API_KEY and the sandbox buyer login');
    this.http = config.fetch ?? fetch;
    this.base = config.baseUrl ?? 'https://api.onkernel.com';
  }
  async approve(link: string): Promise<void> {
    const target = URL.canParse(link) ? new URL(link) : null;
    if (target?.protocol !== 'https:' || target.hostname !== 'www.sandbox.paypal.com') throw new Error('NOT_SANDBOX');
    const created = await this.http(`${this.base}/browsers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ headless: true, timeout_seconds: 300 }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!created.ok) throw new Error(`KERNEL_UNAVAILABLE ${created.status}`);
    const session = (await created.json()) as { session_id?: string; cdp_ws_url?: string };
    if (!session.session_id || !session.cdp_ws_url?.startsWith('wss://')) throw new Error('KERNEL_UNEXPECTED');
    try {
      if (!this.config.connect) throw new Error('KERNEL_NO_BROWSER');
      const browser = await this.config.connect(session.cdp_ws_url);
      try {
        const page = browser.page;
        await page.goto(target.href);
        await page.waitForSelector(`#email, ${APPROVE}`, { timeout: 60_000 });
        if (await page.isVisible('#email')) {
          await page.fill('#email', this.config.buyerEmail);
          await page.click('#btnNext');
          await page.waitForSelector('#password', { timeout: 30_000 });
          await page.fill('#password', this.config.buyerPassword);
          await page.click('#btnLogin');
        }
        await page.click(APPROVE);
        // Approved once PayPal hands the buyer back to the merchant's return URL.
        await page.waitForURL((u) => !u.hostname.endsWith('paypal.com'), { timeout: 60_000 });
      } finally {
        await browser.close();
      }
    } finally {
      await this.http(`${this.base}/browsers/${encodeURIComponent(session.session_id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
        signal: AbortSignal.timeout(30_000),
      }).catch(() => undefined);
    }
  }
}
