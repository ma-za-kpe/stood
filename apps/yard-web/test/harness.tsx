// T-0275: shared harness for Yard page component tests (jsdom). The API is a scripted router over fetch;
// nothing reaches a network.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, type RenderResult, render as rtlRender } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, vi } from 'vitest';

// Tell React this environment drives updates through act().
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom does not lay out pages; scrolling into view is a no-op here.
Element.prototype.scrollIntoView = () => undefined;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

export function render(ui: ReactElement): RenderResult & { client: QueryClient } {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Number.POSITIVE_INFINITY }, mutations: { retry: false } },
  });
  return { client, ...rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>) };
}

export type Call = Readonly<{ method: string; path: string; body: string; headers: Headers }>;
type Reply = Readonly<{ status?: number; body?: unknown }> | Promise<Readonly<{ status?: number; body?: unknown }>>;

// Route /app/api/* requests to `reply`. Returns every call made, in order.
export function api(reply: (call: Call) => Reply): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://yard.test');
      const call = {
        method: (init?.method ?? 'GET').toUpperCase(),
        path: url.pathname.replace(/^\/app\/api/, '') + url.search,
        body: typeof init?.body === 'string' ? init.body : '',
        headers: new Headers(init?.headers),
      };
      calls.push(call);
      const r = await reply(call);
      return new Response(r.body === undefined ? null : JSON.stringify(r.body), {
        status: r.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
  return calls;
}

export const order = (state: string, i = 0) => ({
  id: `o${i}`,
  name: `Milestone ${i + 1}`,
  state,
  budgetMinor: 1000,
  trancheId: `t${i}`,
  payment:
    state === 'PAID'
      ? {
          trancheId: `t${i}`,
          packageId: 'p',
          reference: 'r',
          effect: 'CAPTURE',
          minor: 1000,
          currency: 'USD',
          simulated: true,
        }
      : null,
  submission: state === 'PAID' ? { packageId: 'p', commit: 'a'.repeat(40) } : null,
  leasedUntil: null,
});

// A scripted EventSource: tests open it, send named events, raise errors and see when the page closes it.
export class Stream {
  static all: Stream[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private readonly listeners = new Map<string, ((e: { data: string; type: string }) => void)[]>();
  constructor(readonly url: string) {
    Stream.all.push(this);
  }
  addEventListener(type: string, listener: (e: { data: string; type: string }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() {
    this.closed = true;
  }
  open() {
    this.onopen?.();
  }
  fail() {
    this.onerror?.();
  }
  send(type: string, data: unknown = {}) {
    for (const listener of this.listeners.get(type) ?? [])
      listener({ type, data: typeof data === 'string' ? data : JSON.stringify(data) });
  }
}
export function streams(): Stream[] {
  Stream.all = [];
  vi.stubGlobal('EventSource', Stream);
  return Stream.all;
}
