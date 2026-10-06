import type { BrowserQa, QaResult, QaStep } from '../../ports/browser-qa.js';

// Local stand-in for a cloud browser: fetches the page and checks visible text. No JavaScript,
// no Kernel account and no keys; results are labelled simulated.
export class HttpBrowserQa implements BrowserQa {
  constructor(private readonly transport: (request: Request) => Promise<Response> = fetch) {}
  async check(url: string, steps: readonly QaStep[]): Promise<QaResult> {
    if (!/^https?:\/\/[^\s]+$/.test(url) || !steps.length || steps[0]?.action !== 'visit')
      return { passed: false, observations: ['invalid plan'], simulated: true };
    let body = '';
    const observations: string[] = [];
    try {
      const response = await this.transport(
        new Request(url, { redirect: 'error', signal: AbortSignal.timeout(10000) }),
      );
      body = (await response.text()).slice(0, 1_000_000);
      observations.push(`visit ${response.status}`);
      if (!response.ok) return { passed: false, observations, simulated: true };
    } catch {
      return { passed: false, observations: ['visit failed'], simulated: true };
    }
    let passed = true;
    for (const step of steps.slice(1)) {
      if (step.action !== 'expectText') continue;
      const found = body.includes(step.text);
      observations.push(`${found ? 'found' : 'missing'}: ${step.text.slice(0, 80)}`);
      passed &&= found;
    }
    return { passed, observations, simulated: true };
  }
}
