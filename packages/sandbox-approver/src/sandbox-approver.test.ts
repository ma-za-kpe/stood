import { describe, expect, it } from 'vitest';
import { type ApprovalPage, KernelSandboxApprover } from './sandbox-approver.js';

const link = 'https://www.sandbox.paypal.com/checkoutnow?token=EC-TEST-TOKEN';
const english = `${link}&locale.x=en_US`;
function harness(
  over: {
    returnTo?: string;
    loginShown?: boolean;
    responses?: Response[];
    networkFailure?: boolean;
    createDurationMs?: number;
    connectionFailure?: boolean;
    pageFailure?: boolean;
    waitFailure?: boolean;
  } = {},
) {
  const calls: string[] = [];
  let url = '';
  const page: ApprovalPage = {
    goto: async (u) => {
      calls.push(`goto ${u}`);
      url = u;
      if (over.pageFailure) throw new Error('page failed');
    },
    waitForSelector: async (s) => {
      calls.push(`wait ${s}`);
      if (over.waitFailure) throw new Error('private page details');
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
    capture: async (step) => {
      calls.push(`capture ${step}`);
    },
    waitForURL: async (test) => {
      if (!test(new URL(url))) throw new Error('timeout');
    },
  };
  const kernel: string[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    kernel.push(`${request.method} ${new URL(request.url).pathname} ${request.headers.get('Authorization')}`);
    if (request.method === 'POST') {
      clock += over.createDurationMs ?? 0;
      if (over.networkFailure) throw new Error('private provider details');
    }
    if (request.method === 'POST' && over.responses?.length) return over.responses.shift() as Response;
    if (request.method === 'POST')
      return Response.json({ session_id: 'ses_1', cdp_ws_url: 'wss://cdp.kernel.test/ses_1' }, { status: 201 });
    return new Response(null, { status: 204 });
  };
  const connected: string[] = [];
  const waits: number[] = [];
  const retries: { reason: string }[] = [];
  let clock = 0;
  const approver = new KernelSandboxApprover({
    apiKey: 'kernel-key',
    buyerEmail: 'buyer@personal.example.com',
    buyerPassword: 'sandbox-password',
    fetch,
    retryRuntime: {
      clock: () => clock,
      wallClock: () => Date.parse('2026-10-12T00:00:00Z'),
      random: () => 0,
      sleep: async (ms: number) => {
        waits.push(ms);
        clock += ms;
      },
      onRetry: (event) => {
        retries.push(event);
      },
    },
    connect: async (cdp) => {
      connected.push(cdp);
      if (over.connectionFailure) throw new Error('connect failed');
      return { page, close: async () => void calls.push('close') };
    },
  });
  return { approver, calls, kernel, connected, waits, retries };
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
      'capture 1-sign-in',
      'fill input[type=email], #email buyer@personal.example.com',
      'click #btnNext, button:has-text("Next")',
      'wait #password, input[type=password]',
      'capture 2-password',
      'fill #password, input[type=password] <hidden>',
      'click #btnLogin, button:has-text("Log In")',
      `wait ${approve}`,
      'capture 3-approve',
      `click ${approve}`,
      'capture 4-approved',
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

it('waits for Retry-After on 429 and backs off on 529 before approving once', async () => {
  const h = harness({
    responses: [
      new Response(null, { status: 429, headers: { 'Retry-After': '3' } }),
      new Response(null, { status: 529 }),
    ],
  });
  await h.approver.approve(link);
  expect(h.waits).toEqual([3000, 1000]);
  expect(h.kernel.filter((x) => x.startsWith('POST'))).toHaveLength(3);
  expect(h.connected).toHaveLength(1);
  expect(h.kernel.filter((x) => x.startsWith('DELETE'))).toEqual(['DELETE /browsers/ses_1 Bearer kernel-key']);
});

it('waits for org/project capacity and preserves only the safe error code after bounded retries', async () => {
  for (const code of ['org_limit_exceeded', 'project_limit_exceeded']) {
    const h = harness({
      responses: Array.from({ length: 10 }, () =>
        Response.json({ code, message: 'private provider details' }, { status: 429 }),
      ),
    });
    await expect(h.approver.approve(link)).rejects.toMatchObject({
      code: 'KERNEL_RETRY_EXHAUSTED',
      status: 429,
      reason: code,
    });
    expect(h.kernel.filter((x) => x.startsWith('POST'))).toHaveLength(10);
    expect(h.waits.reduce((a, b) => a + b, 0)).toBeLessThan(120000);
    expect(h.retries.every((x) => x.reason === code)).toBe(true);
    expect(h.kernel.some((x) => x.startsWith('DELETE') || x.startsWith('GET'))).toBe(false);
  }
});
it('honours a long retry hint by ending the run rather than sending an early request', async () => {
  const h = harness({ responses: [new Response(null, { status: 429, headers: { 'Retry-After': '3600' } })] });
  await expect(h.approver.approve(link)).rejects.toMatchObject({ code: 'KERNEL_RETRY_EXHAUSTED' });
  expect(h.waits).toEqual([]);
  expect(h.kernel).toHaveLength(1);
});
it('bounds elapsed time even when each rejected HTTP request is slow', async () => {
  const h = harness({
    responses: Array.from({ length: 10 }, () => new Response(null, { status: 529 })),
    createDurationMs: 30000,
  });
  await expect(h.approver.approve(link)).rejects.toMatchObject({ code: 'KERNEL_RETRY_EXHAUSTED' });
  expect(h.kernel.length).toBeLessThanOrEqual(4);
});
it('does not repeat ambiguous network writes or ordinary non-retryable errors', async () => {
  const unknown = harness({ networkFailure: true });
  await expect(unknown.approver.approve(link)).rejects.toMatchObject({ code: 'KERNEL_CREATE_UNKNOWN' });
  expect(unknown.kernel).toHaveLength(1);
  expect(unknown.waits).toEqual([]);
  for (const status of [400, 401, 403, 500, 503]) {
    const h = harness({ responses: [Response.json({ message: 'private provider details' }, { status })] });
    await expect(h.approver.approve(link)).rejects.toMatchObject({ code: 'KERNEL_UNAVAILABLE', status });
    expect(h.kernel).toHaveLength(1);
    expect(h.waits).toEqual([]);
  }
});

it('deletes a known owned session even when its CDP reply is malformed', async () => {
  const h = harness({
    responses: [Response.json({ session_id: 'ses_owned', cdp_ws_url: 'invalid' }, { status: 201 })],
  });
  await expect(h.approver.approve(link)).rejects.toMatchObject({
    code: 'KERNEL_APPROVAL_BROWSER_FAILED',
    stage: 'SESSION_RESPONSE',
  });
  expect(h.kernel.at(-1)).toBe('DELETE /browsers/ses_owned Bearer kernel-key');
  expect(h.connected).toEqual([]);
});

it('records a safe PayPal page stage when browser approval times out', async () => {
  const h = harness({ waitFailure: true });
  await expect(h.approver.approve(link)).rejects.toMatchObject({
    code: 'KERNEL_APPROVAL_BROWSER_FAILED',
    stage: 'PAYPAL_INITIAL_PAGE',
  });
  expect(h.kernel.at(-1)).toBe('DELETE /browsers/ses_1 Bearer kernel-key');
});

it('attempts owned-session deletion on connection and page failures without retrying approval', async () => {
  for (const over of [{ connectionFailure: true }, { pageFailure: true }]) {
    const h = harness(over);
    await expect(h.approver.approve(link)).rejects.toMatchObject({
      code: 'KERNEL_APPROVAL_BROWSER_FAILED',
      stage: over.connectionFailure ? 'BROWSER_CONNECT' : 'PAYPAL_NAVIGATION',
    });
    expect(h.kernel).toEqual(['POST /browsers Bearer kernel-key', 'DELETE /browsers/ses_1 Bearer kernel-key']);
    if (over.pageFailure) expect(h.calls.at(-1)).toBe('close');
  }
});
