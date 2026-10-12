import { setTimeout as pause } from 'node:timers/promises';
import { retryDelay } from './browser-retry.js';

// The slice of a Playwright page the approval needs; the CLI connects a real one over CDP.
export type ApprovalPage = Readonly<{
  goto(url: string): Promise<unknown>;
  waitForSelector(selector: string, options?: { timeout?: number }): Promise<unknown>;
  isVisible(selector: string): Promise<boolean>;
  fill(selector: string, value: string): Promise<void>;
  click(selector: string): Promise<void>;
  url(): string;
  waitForURL(test: (url: URL) => boolean, options?: { timeout?: number }): Promise<void>;
  // Optional evidence: a screenshot of the current step, with the buyer's login masked by the caller.
  capture?(step: string): Promise<void>;
}>;
type RetryEvent = Readonly<{ attempt: number; status: number; delayMs: number; reason: string }>;
export type KernelRetryRuntime = Readonly<{
  clock(): number;
  wallClock(): number;
  random(): number;
  sleep(ms: number): Promise<void>;
  onRetry(event: RetryEvent): void;
}>;
export class KernelBrowserError extends Error {
  constructor(
    readonly code: 'KERNEL_CREATE_UNKNOWN' | 'KERNEL_UNAVAILABLE' | 'KERNEL_RETRY_EXHAUSTED',
    readonly status?: number,
    readonly reason?: string,
  ) {
    super(`${code}${status === undefined ? '' : ` ${status}`}`);
  }
}
type Config = Readonly<{
  apiKey: string;
  buyerEmail: string;
  buyerPassword: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  retryRuntime?: Partial<KernelRetryRuntime>;
  connect?: (cdpUrl: string) => Promise<Readonly<{ page: ApprovalPage; close(): Promise<void> }>>;
}>;
// PayPal's sandbox checkout (2026-10, the /pay flow, forced to English with locale.x): email, Next, password,
// Log In, then "Review Order" (#one-time-cta), or "Agree and Continue" (#consentButton) when saving PayPal for later
// payments. The older layout's ids and "Agree & Continue" still match. Kernel's browser may otherwise get a Portuguese page.
const EMAIL = 'input[type=email], #email';
const NEXT = '#btnNext, button:has-text("Next")';
const PASSWORD = '#password, input[type=password]';
const LOGIN = '#btnLogin, button:has-text("Log In")';
const APPROVE =
  '#one-time-cta, button:has-text("Review Order"), #consentButton, button:has-text("Agree and Continue"), #payment-submit-btn, button:has-text("Agree & Continue")';

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
  private async createBrowser(): Promise<Response> {
    const runtime: KernelRetryRuntime = {
      clock: () => performance.now(),
      wallClock: () => Date.now(),
      random: () => Math.random(),
      sleep: async (ms) => {
        await pause(ms);
      },
      onRetry: (event) =>
        process.stderr.write(`${JSON.stringify({ code: 'KERNEL_BROWSER_CREATE_RETRY', ...event })}\n`),
      ...this.config.retryRuntime,
    };
    const started = runtime.clock();
    let status: number | undefined;
    for (let attempt = 0; attempt < 6; attempt++) {
      const remaining = 120000 - (runtime.clock() - started);
      if (remaining <= 0) throw new KernelBrowserError('KERNEL_RETRY_EXHAUSTED', status);
      let response: Response;
      try {
        response = await this.http(`${this.base}/browsers`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.config.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ headless: true, timeout_seconds: 300 }),
          signal: AbortSignal.timeout(Math.max(1, Math.floor(Math.min(30000, remaining)))),
        });
      } catch {
        // A lost create reply may have allocated a browser. Do not create another blindly.
        throw new KernelBrowserError('KERNEL_CREATE_UNKNOWN');
      }
      if (response.ok) return response;
      status = response.status;
      if (status !== 429 && status !== 529) throw new KernelBrowserError('KERNEL_UNAVAILABLE', status);
      await response.body?.cancel().catch(() => undefined);
      const delayMs = retryDelay(
        attempt,
        response.headers.get('Retry-After'),
        runtime.wallClock(),
        120000 - (runtime.clock() - started),
        runtime.random(),
      );
      if (attempt === 5 || delayMs === null) throw new KernelBrowserError('KERNEL_RETRY_EXHAUSTED', status);
      try {
        runtime.onRetry({ attempt: attempt + 1, status, delayMs, reason: status === 429 ? 'RATE_LIMIT' : 'CAPACITY' });
      } catch {
        /* Diagnostics do not own the approval. */
      }
      await runtime.sleep(delayMs);
    }
    throw new KernelBrowserError('KERNEL_RETRY_EXHAUSTED', status);
  }
  async approve(link: string): Promise<void> {
    const target = URL.canParse(link) ? new URL(link) : null;
    if (target?.protocol !== 'https:' || target.hostname !== 'www.sandbox.paypal.com') throw new Error('NOT_SANDBOX');
    const created = await this.createBrowser();
    const session = (await created.json()) as { session_id?: string; cdp_ws_url?: string };
    if (!session.session_id || !session.cdp_ws_url?.startsWith('wss://')) throw new Error('KERNEL_UNEXPECTED');
    try {
      if (!this.config.connect) throw new Error('KERNEL_NO_BROWSER');
      const browser = await this.config.connect(session.cdp_ws_url);
      try {
        const page = browser.page;
        const english = new URL(target.href);
        english.searchParams.set('locale.x', 'en_US');
        await page.goto(english.href);
        await page.waitForSelector(`${EMAIL}, ${APPROVE}`, { timeout: 60_000 });
        // Screenshots are evidence only: a failed capture never stops an approval.
        const capture = (step: string) => page.capture?.(step).catch(() => undefined);
        if (await page.isVisible(EMAIL)) {
          await capture('1-sign-in');
          await page.fill(EMAIL, this.config.buyerEmail);
          await page.click(NEXT);
          await page.waitForSelector(PASSWORD, { timeout: 30_000 });
          await capture('2-password');
          await page.fill(PASSWORD, this.config.buyerPassword);
          await page.click(LOGIN);
          await page.waitForSelector(APPROVE, { timeout: 60_000 });
        }
        await capture('3-approve');
        await page.click(APPROVE);
        // With a return URL PayPal hands the buyer back; without one (plain funding orders) it stays put. Either way
        // the caller confirms approval from PayPal's API (the sandbox run polls for APPROVED), never from the page.
        await page
          .waitForURL((u) => u.hostname !== 'paypal.com' && !u.hostname.endsWith('.paypal.com'), { timeout: 15_000 })
          .catch(() => undefined);
        await capture('4-approved');
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
