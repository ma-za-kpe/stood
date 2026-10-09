import { describe, expect, it } from 'vitest';
import { type ApprovalPage, KernelSandboxApprover } from './sandbox-approver.js';

const link = 'https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T';
function harness(over: { returnTo?: string; loginShown?: boolean } = {}) {
  const calls: string[] = [];
  let url = '';
  const page: ApprovalPage = {
    goto: async (u) => {
      calls.push(`goto ${u}`);
      url = u;
    },
    waitForSelector: async (s) => {
      calls.push(`wait ${s}`);
    },
    isVisible: async (s) => (s === '#email' ? over.loginShown !== false : true),
    fill: async (s, v) => {
      calls.push(`fill ${s} ${s === '#password' ? '<hidden>' : v}`);
    },
    click: async (s) => {
      calls.push(`click ${s}`);
      if (s.includes('Agree')) url = over.returnTo ?? 'https://stood-api.onrender.com/v1/approved?token=x';
    },
    url: () => url,
    waitForURL: async (test) => {
      if (!test(new URL(url))) throw new Error('timeout');
    },
  };
  const kernel: string[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    kernel.push(`${request.method} ${new URL(request.url).pathname} ${request.headers.get('Authorization')}`);
    if (request.method === 'POST')
      return Response.json({ session_id: 'ses_1', cdp_ws_url: 'wss://cdp.kernel.test/ses_1' }, { status: 201 });
    return new Response(null, { status: 204 });
  };
  const connected: string[] = [];
  const approver = new KernelSandboxApprover({
    apiKey: 'kernel-key',
    buyerEmail: 'buyer@personal.example.com',
    buyerPassword: 'sandbox-password',
    fetch,
    connect: async (cdp) => {
      connected.push(cdp);
      return { page, close: async () => void calls.push('close') };
    },
  });
  return { approver, calls, kernel, connected };
}

// C3: judges replay every sandbox outcome unattended. Kernel's cloud browser signs in as the SANDBOX buyer and
// approves; it never opens anything but the PayPal sandbox, and the cloud browser is always closed.
describe('KernelSandboxApprover', () => {
  it('signs in as the sandbox buyer, approves, waits for the return and closes the cloud browser', async () => {
    const h = harness();
    await h.approver.approve(link);
    expect(h.connected).toEqual(['wss://cdp.kernel.test/ses_1']);
    expect(h.calls).toEqual([
      `goto ${link}`,
      'wait #email, #payment-submit-btn, button:has-text("Agree & Continue")',
      'fill #email buyer@personal.example.com',
      'click #btnNext',
      'wait #password',
      'fill #password <hidden>',
      'click #btnLogin',
      'click #payment-submit-btn, button:has-text("Agree & Continue")',
      'close',
    ]);
    expect(h.kernel).toEqual(['POST /browsers Bearer kernel-key', 'DELETE /browsers/ses_1 Bearer kernel-key']);
  });

  it('skips sign-in when PayPal remembers the buyer', async () => {
    const h = harness({ loginShown: false });
    await h.approver.approve(link);
    expect(h.calls.some((c) => c.startsWith('fill'))).toBe(false);
  });

  it('refuses any link but the PayPal sandbox and still closes the browser when approval fails', async () => {
    for (const bad of [
      'https://www.paypal.com/checkoutnow?token=x',
      'http://www.sandbox.paypal.com/checkoutnow?token=x',
      'https://www.sandbox.paypal.com.evil.example/x',
    ]) {
      const h = harness();
      await expect(h.approver.approve(bad)).rejects.toThrow('NOT_SANDBOX');
      expect(h.kernel).toEqual([]);
    }
    const stuck = harness({ returnTo: 'https://www.sandbox.paypal.com/still-here' });
    await expect(stuck.approver.approve(link)).rejects.toThrow();
    expect(stuck.calls.at(-1)).toBe('close');
    expect(stuck.kernel.at(-1)).toBe('DELETE /browsers/ses_1 Bearer kernel-key');
    expect(() => new KernelSandboxApprover({ apiKey: '', buyerEmail: 'b@x.co', buyerPassword: 'p' })).toThrow();
  });
});
