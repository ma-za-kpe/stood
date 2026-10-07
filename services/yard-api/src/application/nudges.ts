import { createHmac, randomUUID } from 'node:crypto';

export type NudgeConfig = Readonly<{
  boardUrl: string;
  endpoints: readonly Readonly<{ url: string; keyId: string; secret: string }>[];
  transport?: (request: Request) => Promise<Response>;
}>;
// Best-effort, signed "work was posted" hints to registered operators. Any operator may register;
// builders must still work by polling the Board, so a failed nudge never fails the post.
export class Nudges {
  constructor(private readonly config: NudgeConfig) {
    if (
      !/^https?:\/\/[^\s]+$/.test(config.boardUrl) ||
      config.endpoints.some((e) => !/^https?:\/\/[^\s]+$/.test(e.url) || !e.keyId.trim() || !e.secret.trim())
    )
      throw new RangeError('Invalid nudge configuration');
  }
  // `now` is the request's server clock (simulated in the demo), so receivers can check freshness.
  async posted(ids: readonly string[], now: number): Promise<number> {
    const raw = JSON.stringify({ work_order_ids: [...ids], board_url: this.config.boardUrl });
    const t = String(Math.floor(now / 1000));
    const results = await Promise.allSettled(
      this.config.endpoints.map(async (e) => {
        const response = await (this.config.transport ?? fetch)(
          new Request(e.url, {
            method: 'POST',
            body: raw,
            redirect: 'error',
            signal: AbortSignal.timeout(5000),
            headers: {
              'Content-Type': 'application/json',
              'Crew-Key-Id': e.keyId,
              'Crew-Signature': `t=${t},v1=${createHmac('sha256', e.secret).update(`${t}.${raw}`).digest('hex')}`,
              'Idempotency-Key': `nudge-${randomUUID()}`,
            },
          }),
        );
        if (!response.ok) throw new Error('nudge refused');
      }),
    );
    return results.filter((r) => r.status === 'fulfilled').length;
  }
}
