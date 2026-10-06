import type { Notice, Notifier } from '../../ports/notifications.js';

// Local/demo email through Mailpit's HTTP send API. A hosted sender (Resend, Postmark) replaces this.
export class MailpitNotifier implements Notifier {
  constructor(
    private readonly baseUrl: string,
    private readonly from = 'yard@example.invalid',
    private readonly transport: (request: Request) => Promise<Response> = fetch,
  ) {
    if (!/^http:\/\/(localhost|127\.0\.0\.1|mail|mailpit)(:\d+)?$/.test(baseUrl))
      throw new RangeError('Local Mailpit only');
  }
  async send(notice: Notice): Promise<void> {
    const response = await this.transport(
      new Request(`${this.baseUrl}/api/v1/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          From: { Email: this.from, Name: 'Yard' },
          To: [{ Email: notice.to }],
          Subject: notice.subject,
          Text: notice.text,
          Headers: { 'X-Yard-Notice': notice.key, 'X-Stood-Simulated': 'true' },
        }),
        signal: AbortSignal.timeout(5000),
      }),
    );
    if (!response.ok) throw new Error('Mailpit refused the notice');
  }
}
