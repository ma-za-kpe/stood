// A read-only clock port. The control service is isolated from the production package.
export class ControlledClockClient {
  private readonly origin: string;
  constructor(environment: string, baseUrl: string) {
    let url: URL;
    try {
      url = new URL(baseUrl);
    } catch {
      throw new Error('Controlled clock is not configured');
    }
    if (
      !['local', 'ci', 'demo'].includes(environment) ||
      url.protocol !== 'http:' ||
      !['127.0.0.1', '[::1]', 'paypal-sim'].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      throw new Error('Controlled clock is not configured');
    this.origin = url.origin;
  }
  async read(): Promise<number> {
    try {
      const response = await fetch(`${this.origin}/__sim/time`, {
        redirect: 'error',
        signal: AbortSignal.timeout(2000),
        headers: { Authorization: 'Bearer sim-access-token' },
      });
      if (!response.ok || response.redirected || response.headers.get('x-stood-simulated') !== 'true')
        throw new Error('Controlled clock unavailable');
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Controlled clock unavailable');
      let raw = '';
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        raw += Buffer.from(chunk.value).toString('utf8');
        if (Buffer.byteLength(raw) > 1024) {
          await reader.cancel();
          throw new Error('Controlled clock unavailable');
        }
      }
      const value: unknown = JSON.parse(raw);
      if (
        !value ||
        typeof value !== 'object' ||
        !('simulated' in value) ||
        value.simulated !== true ||
        !('now' in value) ||
        !Number.isSafeInteger(value.now) ||
        Number(value.now) < 0
      )
        throw new Error('Controlled clock unavailable');
      return Number(value.now);
    } catch {
      throw new Error('Controlled clock unavailable');
    }
  }
}
