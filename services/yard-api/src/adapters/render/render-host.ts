import type { PreviewHost } from '../../ports/previews.js';

// Render-shaped preview services in Yard's own workspace (Y20 option C). Live use needs a Render API
// key with a spend cap; tests and the demo use the in-process Render API fake.
export class RenderPreviewHost implements PreviewHost {
  private readonly base: string;
  private readonly transport: (request: Request) => Promise<Response>;
  constructor(
    private readonly config: Readonly<{
      apiKey: string;
      ownerId: string;
      baseUrl?: string;
      transport?: (request: Request) => Promise<Response>;
    }>,
  ) {
    if (!config.apiKey.trim() || !/^[a-z0-9-]{3,64}$/.test(config.ownerId))
      throw new RangeError('Invalid Render configuration');
    this.base = config.baseUrl ?? 'https://api.render.com';
    this.transport = config.transport ?? fetch;
  }
  private async call(method: string, path: string, body?: unknown) {
    const response = await this.transport(
      new Request(`${this.base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      }),
    );
    if (!response.ok) throw new Error(`Render ${method} ${response.status}`);
    return response.status === 204 ? null : ((await response.json()) as Record<string, unknown>);
  }
  async deploy(input: Readonly<{ name: string; image: string; env: Readonly<Record<string, string>> }>) {
    const created = (await this.call('POST', '/v1/services', {
      type: 'web_service',
      name: input.name,
      ownerId: this.config.ownerId,
      image: { ownerId: this.config.ownerId, imagePath: input.image },
      envVars: Object.entries(input.env).map(([key, value]) => ({ key, value })),
      serviceDetails: { runtime: 'image', plan: 'free', region: 'frankfurt' },
    })) as { service?: { id?: string; serviceDetails?: { url?: string } } };
    const id = created?.service?.id,
      url = created?.service?.serviceDetails?.url;
    if (typeof id !== 'string' || typeof url !== 'string' || !url.startsWith('https://'))
      throw new Error('Render returned an unexpected service');
    return { serviceId: id, url };
  }
  async destroy(serviceId: string) {
    if (!/^srv-[a-z0-9]+$/.test(serviceId)) throw new RangeError('Invalid service id');
    await this.call('DELETE', `/v1/services/${serviceId}`);
  }
}
