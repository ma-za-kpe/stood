import { randomBytes } from 'node:crypto';
import { Hono } from 'hono';

type Service = {
  id: string;
  name: string;
  ownerId: string;
  image: { imagePath: string };
  envVars: { key: string; value: string }[];
};
// In-process stand-in for the Render API: create a service from an image, delete it, cap the count.
export function renderApiFake(config: Readonly<{ apiKey: string; maxServices: number }>) {
  const services = new Map<string, Service>();
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (c.req.header('Authorization') !== `Bearer ${config.apiKey}`) return c.json({ message: 'unauthorized' }, 401);
    return next();
  });
  app.post('/v1/services', async (c) => {
    const body = (await c.req.json()) as Partial<Service> & { type?: string };
    if (body.type !== 'web_service' || !body.name || !body.image?.imagePath || !Array.isArray(body.envVars))
      return c.json({ message: 'invalid service' }, 400);
    if (services.size >= config.maxServices) return c.json({ message: 'spend cap reached' }, 402);
    const id = `srv-${randomBytes(6).toString('hex')}`;
    services.set(id, {
      id,
      name: body.name,
      ownerId: String(body.ownerId),
      image: { imagePath: body.image.imagePath },
      envVars: body.envVars.map((e) => ({ key: e.key, value: e.value })),
    });
    return c.json(
      { service: { id, serviceDetails: { url: `https://${body.name}.onrender.com` } }, deployId: `dep-${id}` },
      201,
    );
  });
  app.delete('/v1/services/:id', (c) =>
    services.delete(c.req.param('id')) ? c.body(null, 204) : c.json({ message: 'not found' }, 404),
  );
  return {
    fetch: async (request: Request) =>
      app.fetch(new Request(request.url.replace('https://api.render.com', 'http://render'), request)),
    services: () => [...services.values()].map((s) => structuredClone(s)),
  };
}
