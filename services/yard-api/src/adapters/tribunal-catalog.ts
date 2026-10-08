import { type Catalog, catalogSchema } from '@stood/yard-contracts';
// Fixed outbound origin, no credentials, no redirects; ten-minute cache and one shared request preserve the
// catalog's 30 requests/hour budget. A failed refresh does not invent a fresh research result.
export class TribunalCatalog {
  private cached: { value: Catalog; until: number } | null = null;
  private pending: Promise<Catalog> | null = null;
  private retryAt = 0;
  constructor(
    private readonly request: typeof fetch = fetch,
    private readonly clock = Date.now,
  ) {}
  async list(): Promise<Catalog> {
    if (this.cached && this.clock() < this.cached.until) return structuredClone(this.cached.value);
    if (this.clock() < this.retryAt) throw new Error('RESEARCH_UNAVAILABLE');
    if (!this.pending)
      this.pending = this.read().finally(() => {
        this.pending = null;
      });
    return structuredClone(await this.pending);
  }
  private async read(): Promise<Catalog> {
    try {
      const response = await this.request('https://startuptribunal.com/api/public/ideas?limit=10', {
        redirect: 'error',
        credentials: 'omit',
        signal: AbortSignal.timeout(5000),
      });
      if (response.status === 429) {
        const seconds = Number(response.headers.get('Retry-After'));
        this.retryAt =
          this.clock() + (Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 86400) * 1000 : 3600_000);
      }
      if (!response.ok || !response.body) throw new Error();
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.length;
          if (size > 65536) {
            await reader.cancel();
            throw new Error();
          }
          chunks.push(chunk.value);
        }
      } finally {
        reader.releaseLock();
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      const value = catalogSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
      this.cached = { value, until: this.clock() + 600_000 };
      return value;
    } catch {
      // At most 30 failed refreshes/hour, shared across all visitors; keep any longer upstream cooldown.
      this.retryAt = Math.max(this.retryAt, this.clock() + 120_000);
      throw new Error('RESEARCH_UNAVAILABLE');
    }
  }
}
