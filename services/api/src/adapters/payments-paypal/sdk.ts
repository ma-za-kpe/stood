import { ApiError, Client, Environment, OrdersController, PaymentsController } from '@paypal/paypal-server-sdk';
export type PayPalCall = 'CAPTURE' | 'VOID' | 'REAUTHORIZE' | 'GET_AUTHORIZATION' | 'GET_ORDER';
export type PayPalInput = Readonly<{
  authorizationId: string;
  requestId: string;
  operationKey: string;
  amount: Readonly<{ currencyCode: string; value: string }>;
}>;
export interface PayPalTransport {
  call(action: PayPalCall, input: PayPalInput): Promise<Readonly<{ status: number | null; body: unknown }>>;
}
export class ServerSdkTransport implements PayPalTransport {
  private readonly payments: PaymentsController;
  private readonly orders: OrdersController;
  constructor(config: Readonly<{ appEnv: string; baseUrl: string; clientId: string; clientSecret: string }>) {
    if (
      !['local', 'ci', 'demo'].includes(config.appEnv) ||
      config.baseUrl !== 'https://api-m.sandbox.paypal.com' ||
      !config.clientId.trim() ||
      !config.clientSecret.trim()
    )
      throw new Error('Sandbox payments not configured');
    const client = new Client({
      environment: Environment.Sandbox,
      timeout: 10000,
      httpClientOptions: { retryConfig: { maxNumberOfRetries: 0 } },
      clientCredentialsAuthCredentials: { oAuthClientId: config.clientId, oAuthClientSecret: config.clientSecret },
      logging: { logger: { log() {} } },
    });
    this.payments = new PaymentsController(client);
    this.orders = new OrdersController(client);
  }
  async call(action: PayPalCall, input: PayPalInput) {
    try {
      const common = {
        authorizationId: input.authorizationId,
        paypalRequestId: input.requestId,
        prefer: 'return=representation',
      };
      const response =
        action === 'CAPTURE'
          ? await this.payments.captureAuthorizedPayment({
              ...common,
              body: { amount: input.amount, finalCapture: true, invoiceId: input.operationKey },
            })
          : action === 'VOID'
            ? await this.payments.voidPayment(common)
            : action === 'REAUTHORIZE'
              ? await this.payments.reauthorizePayment({ ...common, body: { amount: input.amount } })
              : action === 'GET_AUTHORIZATION'
                ? await this.payments.getAuthorizedPayment({ authorizationId: input.authorizationId })
                : await this.orders.getOrder({ id: input.authorizationId });
      return { status: response.statusCode, body: parseBody(response.body) };
    } catch (error) {
      return {
        status: error instanceof ApiError ? error.statusCode : null,
        body: error instanceof ApiError ? parseBody(error.body) : null,
      };
    }
  }
}
function parseBody(body: unknown): unknown {
  if (typeof body !== 'string') return null;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}
