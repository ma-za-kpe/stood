import { RenderPreviewHost } from './adapters/render/render-host.js';

// Operator tool (T-0196): qualify live previews on Render. It creates one free-plan service from a small public
// image pinned by digest, waits until it answers over https, deletes it and checks it is gone. No buyer keys,
// no paid plan, and the service is always deleted, even when a step fails. Prints no key.
const apiKey = process.env.RENDER_API_KEY ?? '';
const ownerId = process.env.RENDER_OWNER_ID ?? '';
const host = new RenderPreviewHost({ apiKey, ownerId });
const image = 'docker.io/traefik/whoami@sha256:200689790a0a0ea48ca45992e0450bc26ccab5307375b41c84dfc4f2475937ab';
const step = (name: string, detail = '') => process.stdout.write(`ok  ${name}${detail ? `: ${detail}` : ''}\n`);
const started = Date.now();
const service = await host.deploy({
  name: `yard-preview-qualify-${started}`,
  image,
  env: { YARD_PREVIEW: 'simulated-test-data', WHOAMI_PORT_NUMBER: '10000', PORT: '10000' },
});
step('create a free-plan preview from a digest-pinned image', service.serviceId);
try {
  let live = false,
    status = '';
  while (!live && Date.now() - started < 10 * 60_000) {
    await new Promise((r) => setTimeout(r, 10_000));
    let latest = status;
    try {
      const deploys = await fetch(`https://api.render.com/v1/services/${service.serviceId}/deploys?limit=1`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (deploys.ok)
        latest = String(((await deploys.json()) as { deploy?: { status?: string } }[])[0]?.deploy?.status);
    } catch {
      // A slow status read is not a failure; the next poll tries again.
    }
    if (latest !== status) {
      status = latest;
      process.stdout.write(`..  deploy ${status}\n`);
    }
    if (/failed|canceled|deactivated/.test(status)) throw new Error(`deploy ${status}`);
    try {
      const response = await fetch(service.url, { signal: AbortSignal.timeout(10_000) });
      live = response.ok && (await response.text()).includes('Hostname');
    } catch {
      live = false;
    }
  }
  if (!live) throw new Error('preview did not answer within 10 minutes');
  step('serves over https', `${Math.round((Date.now() - started) / 1000)}s`);
} finally {
  await host.destroy(service.serviceId);
  step('delete the preview');
}
const gone = await fetch(`https://api.render.com/v1/services/${service.serviceId}`, {
  headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
});
if (gone.status !== 404) throw new Error(`service still listed (${gone.status})`);
step('Render no longer lists it');
