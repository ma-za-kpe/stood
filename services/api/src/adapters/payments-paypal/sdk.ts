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
  constructor(
    config: Readonly<{
      appEnv: string;
      baseUrl: string;
      clientId: string;
      clientSecret: string;
      mode?: string;
      timeoutMs?: number;
    }>,
  ) {
    const simulated = config.mode === 'sim';
    let simulatorUrl: URL | null = null;
    if (simulated) {
      try {
        simulatorUrl = new URL(config.baseUrl);
      } catch {
        throw new Error('Simulator payments not configured');
      }
      if (
        simulatorUrl.protocol !== 'http:' ||
        !['127.0.0.1', '[::1]', 'paypal-sim'].includes(simulatorUrl.hostname) ||
        simulatorUrl.pathname !== '/' ||
        simulatorUrl.search ||
        simulatorUrl.hash ||
        simulatorUrl.username ||
        simulatorUrl.password ||
        config.clientId !== 'sim-client' ||
        config.clientSecret !== 'sim-secret'
      )
        throw new Error('Simulator payments not configured');
    }
    const timeout = simulated ? (config.timeoutMs ?? 10000) : 10000;
    if (
      !['local', 'ci', 'demo'].includes(config.appEnv) ||
      (!simulated &&
        (config.baseUrl !== 'https://api-m.sandbox.paypal.com' ||
          (config.mode !== undefined && config.mode !== 'live'))) ||
      !Number.isInteger(timeout) ||
      timeout < 1 ||
      timeout > 10000 ||
      !config.clientId.trim() ||
      !config.clientSecret.trim()
    )
      throw new Error('Sandbox payments not configured');
    const client = new Client({
      environment: Environment.Sandbox,
      timeout,
      unstable_httpClientOptions: simulatorUrl
        ? { maxRedirects: 0, adapter: simulatorHttpAdapter(simulatorUrl.origin) }
        : { maxRedirects: 0 },
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
type SimulatorHttpRequest = {
  url: string;
  method: string;
  data?: string;
  headers: Record<string, string>;
  timeout: number;
  auth?: { username: string; password: string };
  signal?: AbortSignal;
};
function simulatorHttpAdapter(origin: string) {
  return async (request: SimulatorHttpRequest) => {
    const url = new URL(request.url);
    if (url.origin !== 'https://api-m.sandbox.paypal.com') throw new Error('Unexpected SDK destination');
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) if (typeof value === 'string') headers.set(key, value);
    if (request.auth) {
      if (request.auth.username !== 'sim-client' || request.auth.password !== 'sim-secret')
        throw new Error('Unexpected simulator credentials');
      headers.set('Authorization', `Basic ${Buffer.from('sim-client:sim-secret').toString('base64')}`);
    }
    const signal = AbortSignal.timeout(request.timeout);
    const response = await fetch(`${origin}${url.pathname}${url.search}`, {
      method: request.method,
      headers,
      ...(request.data ? { body: request.data } : {}),
      redirect: 'error',
      signal: request.signal ? AbortSignal.any([signal, request.signal]) : signal,
    });
    return {
      status: response.status,
      statusText: response.statusText,
      data: await response.text(),
      headers: Object.fromEntries(response.headers),
      config: request,
      request: {},
    };
  };
}
function parseBody(body: unknown): unknown {
  if (typeof body !== 'string') return null;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}
