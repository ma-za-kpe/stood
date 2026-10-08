import {
  ApiError,
  CheckoutPaymentIntent,
  Client,
  Environment,
  OrdersController,
  PaymentsController,
  PaypalPaymentTokenUsageType,
  TransactionSearchController,
  VaultController,
  VaultTokenRequestType,
} from '@paypal/paypal-server-sdk';
import type { ProviderCapture, ProviderTransactions } from '../../ports/provider-transactions.js';
export type PayPalVaultCall = 'CREATE_SETUP' | 'GET_SETUP' | 'CREATE_TOKEN' | 'GET_TOKEN';
export type PayPalVaultInput = Readonly<{
  mode: 'sim' | 'live';
  requestId: string;
  customerRef: string;
  setupId: string | null;
  tokenId: string | null;
  customerId: string | null;
}>;
export interface PayPalVaultTransport {
  vault(action: PayPalVaultCall, input: PayPalVaultInput): Promise<Readonly<{ status: number | null; body: unknown }>>;
}
export type PayPalFundingCall = 'CREATE_ORDER' | 'AUTHORIZE_ORDER' | 'GET_FUNDING_ORDER';
export type PayPalFundingInput = Readonly<{
  mode: 'sim' | 'live';
  orderId: string | null;
  requestId: string;
  operationKey: string;
  trancheId: string;
  payeeRef: string;
  amount: Readonly<{ currencyCode: string; value: string }>;
  // T-0154: a saved PayPal payment token pays a later hold with no buyer present.
  vaultId?: string | null;
}>;
export interface PayPalFundingTransport {
  fund(
    action: PayPalFundingCall,
    input: PayPalFundingInput,
  ): Promise<Readonly<{ status: number | null; body: unknown }>>;
}
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
export class ServerSdkTransport implements PayPalTransport, ProviderTransactions {
  private readonly payments: PaymentsController;
  private readonly orders: OrdersController;
  private readonly vaultController: VaultController;
  private readonly search: TransactionSearchController;
  private readonly searchPageSize: number;
  private readonly callbacks: Readonly<{ returnUrl: string; cancelUrl: string }> | null;
  private readonly mode: 'sim' | 'live';
  constructor(
    config: Readonly<{
      appEnv: string;
      baseUrl: string;
      clientId: string;
      clientSecret: string;
      mode?: string;
      timeoutMs?: number;
      vaultReturnUrl?: string;
      vaultCancelUrl?: string;
      searchPageSize?: number;
    }>,
  ) {
    const simulated = config.mode === 'sim';
    this.mode = simulated ? 'sim' : 'live';
    this.callbacks = vaultCallbacks(config.vaultReturnUrl, config.vaultCancelUrl, simulated);
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
    this.vaultController = new VaultController(client);
    // Controllers are constructed from the client, not reached through it (APIMatic Context Plugin).
    this.search = new TransactionSearchController(client);
    this.searchPageSize = config.searchPageSize ?? 100;
    if (!Number.isInteger(this.searchPageSize) || this.searchPageSize < 1 || this.searchPageSize > 500)
      throw new Error('Invalid search page size');
  }
  async vault(action: PayPalVaultCall, input: PayPalVaultInput) {
    if (input.mode !== this.mode || (action === 'CREATE_SETUP' && !this.callbacks)) return { status: null, body: null };
    try {
      const response =
        action === 'CREATE_SETUP'
          ? await this.vaultController.createSetupToken({
              paypalRequestId: input.requestId,
              body: {
                customer: { merchantCustomerId: input.customerRef },
                // MERCHANT usage is required: without it PayPal creates a setup token the buyer can never approve.
                paymentSource: {
                  paypal: {
                    permitMultiplePaymentTokens: true,
                    usageType: PaypalPaymentTokenUsageType.Merchant,
                    experienceContext: this.callbacks!,
                  },
                },
              },
            })
          : action === 'CREATE_TOKEN'
            ? await this.vaultController.createPaymentToken({
                paypalRequestId: input.requestId,
                body: {
                  customer: { id: input.customerId!, merchantCustomerId: input.customerRef },
                  paymentSource: { token: { id: input.setupId!, type: VaultTokenRequestType.SetupToken } },
                },
              })
            : action === 'GET_SETUP'
              ? await this.vaultController.getSetupToken(input.setupId!)
              : await this.vaultController.getPaymentToken(input.tokenId!);
      return { status: response.statusCode, body: parseBody(response.body) };
    } catch (error) {
      return {
        status: error instanceof ApiError ? error.statusCode : null,
        body: error instanceof ApiError ? parseBody(error.body) : null,
      };
    }
  }
  async fund(action: PayPalFundingCall, input: PayPalFundingInput) {
    if (input.mode !== this.mode) return { status: null, body: null };
    try {
      const response =
        action === 'CREATE_ORDER'
          ? await this.orders.createOrder({
              paypalRequestId: input.requestId,
              prefer: 'return=representation',
              body: {
                intent: CheckoutPaymentIntent.Authorize,
                purchaseUnits: [
                  {
                    referenceId: input.operationKey,
                    customId: input.trancheId,
                    payee: { merchantId: input.payeeRef },
                    amount: input.amount,
                  },
                ],
                ...(input.vaultId ? { paymentSource: { paypal: { vaultId: input.vaultId } } } : {}),
              },
            })
          : action === 'AUTHORIZE_ORDER'
            ? await this.orders.authorizeOrder({
                id: input.orderId!,
                paypalRequestId: input.requestId,
                prefer: 'return=representation',
                body: {},
              })
            : await this.orders.getOrder({ id: input.orderId! });
      return { status: response.statusCode, body: parseBody(response.body) };
    } catch (error) {
      return {
        status: error instanceof ApiError ? error.statusCode : null,
        body: error instanceof ApiError ? parseBody(error.body) : null,
      };
    }
  }
  // T-0155: PayPal Transaction Search through the pinned SDK, every page (APIMatic Context Plugin guidance).
  async captures(fromMs: number, toMs: number): Promise<readonly ProviderCapture[]> {
    // PayPal Transaction Search accepts at most 31 days per request; refuse instead of silently truncating.
    if (
      !Number.isSafeInteger(fromMs) ||
      !Number.isSafeInteger(toMs) ||
      toMs < fromMs ||
      toMs - fromMs > MAX_SEARCH_WINDOW_MS
    )
      throw new RangeError('Transaction search window must be 0-31 days');
    const captures: ProviderCapture[] = [];
    for (let page = 1; ; page++) {
      if (page > MAX_SEARCH_PAGES) throw new Error('Transaction search exceeded the page limit');
      let result: Awaited<ReturnType<TransactionSearchController['searchTransactions']>>['result'];
      try {
        // Form B: one options object, as the SDK generates this list operation.
        ({ result } = await this.search.searchTransactions({
          startDate: new Date(fromMs).toISOString(),
          endDate: new Date(toMs).toISOString(),
          fields: 'transaction_info',
          pageSize: this.searchPageSize,
          page,
        }));
      } catch (error) {
        if (error instanceof ApiError)
          throw new Error(`Transaction search unavailable (HTTP ${error.statusCode}, debug id ${debugId(error.body)})`);
        throw error;
      }
      for (const detail of result.transactionDetails ?? []) {
        const t = detail.transactionInfo;
        const value = t?.transactionAmount?.value;
        if (!t?.transactionId || !value || !/^\d+\.\d{2}$/.test(value) || !t.transactionAmount?.currencyCode)
          throw new Error('Unexpected transaction shape');
        captures.push({
          id: t.transactionId,
          invoiceId: t.invoiceId ?? null,
          minor: Number(value.replace('.', '')),
          currency: t.transactionAmount.currencyCode,
          status: SEARCH_STATUS[t.transactionStatus ?? ''] ?? 'PENDING',
          at: t.transactionInitiationDate ? Date.parse(t.transactionInitiationDate) : null,
        });
      }
      if (page >= (result.totalPages ?? 1)) return captures;
    }
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
function vaultCallbacks(returnUrl?: string, cancelUrl?: string, simulated = false) {
  if (returnUrl === undefined && cancelUrl === undefined) return null;
  try {
    const urls = [returnUrl, cancelUrl].map((value) => {
      if (!value || value.length > 4000) throw new Error();
      const url = new URL(value);
      if (
        url.username ||
        url.password ||
        url.hash ||
        (simulated
          ? url.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'api'].includes(url.hostname)
          : url.protocol !== 'https:')
      )
        throw new Error();
      return url;
    });
    if (urls[0]!.origin !== urls[1]!.origin) throw new Error();
    return { returnUrl: returnUrl!, cancelUrl: cancelUrl! };
  } catch {
    throw new Error('Vault callbacks not configured');
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

const MAX_SEARCH_WINDOW_MS = 31 * 86400000;
const MAX_SEARCH_PAGES = 100;
const SEARCH_STATUS: Readonly<Record<string, ProviderCapture['status']>> = {
  S: 'COMPLETED',
  P: 'PENDING',
  D: 'DECLINED',
  V: 'REFUNDED',
};
function debugId(body: unknown): string {
  try {
    const parsed = typeof body === 'string' ? (JSON.parse(body) as { debug_id?: unknown }) : null;
    return typeof parsed?.debug_id === 'string' ? parsed.debug_id : 'none';
  } catch {
    return 'none';
  }
}
