import { describe, expect, it } from 'vitest';
import { type ApprovalPage, KernelSandboxApprover } from './sandbox-approver.js';

const link = 'https://www.sandbox.paypal.com/checkoutnow?token=EC-TEST-TOKEN';
const english = `${link}&locale.x=en_US`;
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
    isVisible: async (s) => (s.includes('email') ? over.loginShown !== false : true),
    fill: async (s, v) => {
      calls.push(`fill ${s} ${s.includes('password') ? '<hidden>' : v}`);
    },
    click: async (s) => {
      calls.push(`click ${s}`);
      if (s.includes('Review Order')) url = over.returnTo ?? 'https://stood-api.onrender.com/v1/approved?token=x';
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
    const approve =
      '#one-time-cta, button:has-text("Review Order"), #consentButton, button:has-text("Agree and Continue"), #payment-submit-btn, button:has-text("Agree & Continue")';
    expect(h.calls).toEqual([
      `goto ${english}`,
      `wait input[type=email], #email, ${approve}`,
      'fill input[type=email], #email buyer@personal.example.com',
      'click #btnNext, button:has-text("Next")',
      'wait #password, input[type=password]',
      'fill #password, input[type=password] <hidden>',
      'click #btnLogin, button:has-text("Log In")',
      `wait ${approve}`,
      `click ${approve}`,
      'close',
    ]);
    expect(h.kernel).toEqual(['POST /browsers Bearer kernel-key', 'DELETE /browsers/ses_1 Bearer kernel-key']);
  });

  it('skips sign-in when PayPal remembers the buyer', async () => {
    const h = harness({ loginShown: false });
    await h.approver.approve(link);
    expect(h.calls.some((c) => c.startsWith('fill'))).toBe(false);
  });

  it('refuses any link but the PayPal sandbox, and always closes the browser', async () => {
    for (const bad of [
      'https://www.paypal.com/checkoutnow?token=x',
      'http://www.sandbox.paypal.com/checkoutnow?token=x',
      'https://www.sandbox.paypal.com.evil.example/x',
    ]) {
      const h = harness();
      await expect(h.approver.approve(bad)).rejects.toThrow('NOT_SANDBOX');
      expect(h.kernel).toEqual([]);
    }
    // Without a return URL PayPal keeps the buyer on its page; the approver still finishes and closes the browser,
    // and the caller confirms approval from PayPal's API.
    const stays = harness({ returnTo: 'https://www.sandbox.paypal.com/pay/checkout' });
    await stays.approver.approve(link);
    expect(stays.calls.at(-1)).toBe('close');
    expect(stays.kernel.at(-1)).toBe('DELETE /browsers/ses_1 Bearer kernel-key');
    const lookalike = harness({ returnTo: 'https://notpaypal.com/return' });
    await lookalike.approver.approve(link);
    expect(() => new KernelSandboxApprover({ apiKey: '', buyerEmail: 'b@x.co', buyerPassword: 'p' })).toThrow();
  });
});
