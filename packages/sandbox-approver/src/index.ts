// The Kernel cloud-browser approver for PayPal SANDBOX approval pages, shared by Stood's qualification CLIs
// and Yard's demo autopilot. Sandbox only: the approver refuses any host other than www.sandbox.paypal.com.
import type { ApprovalPage } from './sandbox-approver.js';

export { retryDelay } from './browser-retry.js';
export {
  type ApprovalPage,
  KernelApprovalBrowserError,
  KernelBrowserError,
  type KernelRetryRuntime,
  KernelSandboxApprover,
} from './sandbox-approver.js';

// Connects Playwright to a Kernel browser over CDP and exposes only the page calls the approver uses.
export async function connectPlaywright(cdp: string): Promise<{ page: ApprovalPage; close(): Promise<void> }> {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.connectOverCDP(cdp);
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = context.pages()[0] ?? (await context.newPage());
  return {
    page: {
      goto: (u) => page.goto(u),
      waitForSelector: (s, o) => page.waitForSelector(s, o),
      isVisible: (s) => page.isVisible(s),
      fill: (s, v) => page.fill(s, v),
      click: (s) => page.click(s),
      url: () => page.url(),
      waitForURL: (test, o) => page.waitForURL(test, o),
    },
    close: () => browser.close(),
  };
}
