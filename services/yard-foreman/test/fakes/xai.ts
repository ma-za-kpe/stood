// A scripted stand-in for xAI's chat completions API: it answers like a careful model, from the request it receives.
export type XaiCall = Readonly<{ url: string; headers: Headers; body: Record<string, unknown> }>;
export function xaiServer(
  options: { milestones?: number; reply?: (call: XaiCall) => Response | Promise<Response> } = {},
) {
  const calls: XaiCall[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) };
    calls.push(call);
    if (options.reply) return options.reply(call);
    const n = options.milestones ?? 3;
    const draft = {
      summary: 'Customers book a slot, pay a deposit and get a reminder.',
      milestones: Array.from({ length: n }, (_, i) => ({
        id: `m${i + 1}`,
        name: `Stage ${i + 1}`,
        weight: i + 1,
        tests: [
          {
            id: `t${i + 1}`,
            path: `tests/stage-${i + 1}.test.js`,
            content: `import assert from 'node:assert/strict';\nassert.equal(${i + 1}, ${i + 1});\n`,
          },
        ],
      })),
      requirements: [{ id: 'r1', text: 'Customers can book', testIds: ['t1'] }],
      risks: ['Deposit refunds are out of scope.'],
    };
    return new Response(
      JSON.stringify({
        model: call.body.model,
        choices: [{ message: { role: 'assistant', content: JSON.stringify(draft) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1200, completion_tokens: 800 },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };
  return { calls, fetch: fetch as typeof globalThis.fetch };
}
