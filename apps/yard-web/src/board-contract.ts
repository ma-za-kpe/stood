import { z } from 'zod';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const offer = z
  .object({
    id: z.string().regex(/^[a-f0-9]{64}$/),
    projectId: id,
    workOrderId: id,
    name: z.string().min(1).max(4096),
    priceMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    deadline: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    currency: z.enum(['USD', 'GBP', 'EUR']),
    profile: z.enum(['code.milestone@1', 'code.final@1']),
    version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    simulated: z.literal(true),
  })
  .strict();
const page = z.object({ orders: z.array(offer), nextCursor: id.nullable(), simulated: z.literal(true) }).strict();
export type Offer = z.infer<typeof offer>;
export function boardChecked(input: unknown, after = ''): z.infer<typeof page> {
  const result = page.parse(input);
  if (
    new Set(result.orders.map((o) => o.id)).size !== result.orders.length ||
    (result.nextCursor !== null && result.nextCursor <= after)
  )
    throw new Error('Invalid Board continuation');
  return result;
}
export const claimAck = z
  .object({ id, version: z.number().int().positive(), accepted: z.literal(true), simulated: z.literal(true) })
  .strict();
