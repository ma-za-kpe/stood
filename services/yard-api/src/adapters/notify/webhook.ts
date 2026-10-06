import type { Notice, Notifier } from '../../ports/notifications.js';

// Outbound-only notices to an automation catch hook (Zapier in live mode). It can never call Yard or Stood.
export class WebhookNotifier implements Notifier {
  constructor(
    private readonly url: string,
    private readonly transport: (request: Request) => Promise<Response> = fetch,
  ) {
    if (!/^https:\/\/[^\s]+$/.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(url))
      throw new RangeError('Notices go to an https catch hook');
  }
  async send(notice: Notice): Promise<void> {
    const response = await this.transport(
      new Request(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: notice.key,
          to: notice.to,
          subject: notice.subject,
          text: notice.text,
          simulated: true,
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      }),
    );
    if (!response.ok) throw new Error('Catch hook refused the notice');
  }
}
