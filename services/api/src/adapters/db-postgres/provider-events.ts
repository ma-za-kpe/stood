import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';

type ProviderEvent = Readonly<{ id: string; event_type: string; resource: unknown; simulated?: true }>;

// Idempotent store for verified provider notifications: PayPal retries deliveries, so the first copy wins.
export class PostgresProviderEvents {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}
  async enqueue(event: ProviderEvent): Promise<void> {
    await this.db
      .insert(schema.providerEvents)
      .values({
        eventId: event.id,
        eventType: event.event_type,
        resource: event.resource,
        simulated: event.simulated === true,
      })
      .onConflictDoNothing({ target: schema.providerEvents.eventId });
  }
}
