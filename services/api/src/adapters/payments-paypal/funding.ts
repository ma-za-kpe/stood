import type { FundingProvider } from '../../ports/funding-provider.js';
import type { FundingOperation } from '../../ports/funding-store.js';
import type { PayPalFundingCall, PayPalFundingInput, PayPalFundingTransport } from './sdk.js';

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && value.length <= 200;
const unknown = Object.freeze({ complete: false });
function amountMatches(value: unknown, input: PayPalFundingInput) {
  const amount = object(value);
  return amount?.currency_code === input.amount.currencyCode && amount?.value === input.amount.value;
}
function approval(value: unknown, operation: FundingOperation, orderId: string): string | null {
  if (!Array.isArray(value)) return null;
  const links = value.map(object).filter((link) => link?.rel === 'approve');
  if (links.length !== 1 || typeof links[0]?.href !== 'string') return null;
  const href = links[0].href;
  try {
    const url = new URL(href);
    if (
      href.length > 4096 ||
      url.username ||
      url.password ||
      url.hash ||
      (operation.instruction.mode === 'sim'
        ? url.origin !== 'http://paypal-sim:8080' || url.pathname !== `/__sim/approve/${orderId}` || !!url.search
        : url.origin !== 'https://www.sandbox.paypal.com' ||
          url.pathname !== '/checkoutnow' ||
          url.searchParams.get('token') !== orderId)
    )
      return null;
    return href;
  } catch {
    return null;
  }
}
function input(
  operation: FundingOperation,
  action: PayPalFundingCall,
  orderId = operation.orderId,
): PayPalFundingInput {
  const amount = operation.instruction.amount,
    minor = BigInt(amount.minor);
  return {
    mode: operation.instruction.mode,
    orderId,
    requestId: action === 'AUTHORIZE_ORDER' ? operation.authorizeRequestId : operation.createRequestId,
    operationKey: operation.key,
    trancheId: operation.trancheId,
    payeeRef: operation.instruction.payeeRef,
    amount: { currencyCode: amount.currency, value: `${minor / 100n}.${String(minor % 100n).padStart(2, '0')}` },
  };
}
export class PayPalFundingAdapter implements FundingProvider {
  constructor(private readonly transport: PayPalFundingTransport) {}
  create(operation: FundingOperation) {
    if (operation.status !== 'CREATING' || operation.orderId) return Promise.resolve(unknown);
    return this.call('CREATE_ORDER', operation);
  }
  authorize(operation: FundingOperation) {
    if (operation.status !== 'AUTHORIZING' || !operation.orderId) return Promise.resolve(unknown);
    return this.call('AUTHORIZE_ORDER', operation);
  }
  read(operation: FundingOperation, candidateOrderId?: string) {
    const id = operation.orderId ?? candidateOrderId;
    if (
      !id ||
      !/^[A-Za-z0-9_-]{1,200}$/.test(id) ||
      !['CREATING', 'AWAITING_APPROVAL', 'AUTHORIZING'].includes(operation.status)
    )
      return Promise.resolve(unknown);
    return this.call('GET_FUNDING_ORDER', operation, id);
  }
  private async call(
    action: PayPalFundingCall,
    operation: FundingOperation,
    orderId = operation.orderId,
  ): Promise<unknown> {
    try {
      const request = input(operation, action, orderId),
        response = await this.transport.fund(action, request);
      const body = object(response.body);
      const identity = {
        complete: true,
        key: operation.key,
        trancheId: operation.trancheId,
        createRequestId: operation.createRequestId,
        authorizeRequestId: operation.authorizeRequestId,
      };
      if (
        action === 'AUTHORIZE_ORDER' &&
        response.status === 422 &&
        body?.name === 'UNPROCESSABLE_ENTITY' &&
        text(body.message) &&
        text(body.debug_id) &&
        Array.isArray(body.details) &&
        body.details.length > 0 &&
        body.details.every((d) => object(d)?.issue === 'INSTRUMENT_DECLINED')
      )
        return { ...identity, orderId, outcome: 'DECLINED', reference: body.debug_id };
      if (
        !['CREATE_ORDER', 'AUTHORIZE_ORDER'].includes(action)
          ? response.status !== 200
          : ![200, 201].includes(response.status ?? 0)
      )
        return unknown;
      if (
        !body ||
        !text(body.id) ||
        body.intent !== 'AUTHORIZE' ||
        (orderId && body.id !== orderId) ||
        !Array.isArray(body.purchase_units) ||
        body.purchase_units.length !== 1
      )
        return unknown;
      const unit = object(body.purchase_units[0]),
        payments = object(unit?.payments);
      if (
        unit?.reference_id !== operation.key ||
        unit.custom_id !== operation.trancheId ||
        object(unit.payee)?.merchant_id !== operation.instruction.payeeRef ||
        !amountMatches(unit.amount, request)
      )
        return unknown;
      if (body.status === 'CREATED' || body.status === 'APPROVED') {
        if (
          action === 'AUTHORIZE_ORDER' ||
          (payments &&
            (!Array.isArray(payments.authorizations) ||
              payments.authorizations.length ||
              !Array.isArray(payments.captures) ||
              payments.captures.length))
        )
          return unknown;
        const url = operation.approvalUrl ?? approval(body.links, operation, body.id);
        if (!url) return unknown;
        return { ...identity, outcome: body.status, orderId: body.id, approvalUrl: url };
      }
      if (
        action === 'CREATE_ORDER' ||
        body.status !== 'COMPLETED' ||
        !Array.isArray(payments?.authorizations) ||
        payments.authorizations.length !== 1 ||
        !Array.isArray(payments.captures) ||
        payments.captures.length
      )
        return unknown;
      const authorization = object(payments.authorizations[0]);
      if (
        !text(authorization?.id) ||
        !['CREATED', 'EXPIRED'].includes(String(authorization?.status)) ||
        (authorization?.status === 'EXPIRED' && action !== 'GET_FUNDING_ORDER') ||
        !amountMatches(authorization.amount, request) ||
        object(object(authorization.supplementary_data)?.related_ids)?.order_id !== body.id ||
        typeof authorization.create_time !== 'string' ||
        typeof authorization.expiration_time !== 'string'
      )
        return unknown;
      const heldAt = Date.parse(authorization.create_time),
        expiresAt = Date.parse(authorization.expiration_time);
      if (
        !Number.isSafeInteger(heldAt) ||
        heldAt < 0 ||
        !Number.isSafeInteger(expiresAt) ||
        expiresAt <= heldAt ||
        expiresAt - heldAt > 29 * 86400000
      )
        return unknown;
      return {
        ...identity,
        outcome: authorization.status === 'EXPIRED' ? 'EXPIRED' : 'HELD',
        orderId: body.id,
        hold: {
          orderId: body.id,
          authorizationId: authorization.id,
          heldAt,
          expiresAt,
          reference: `${body.id}:${authorization.id}`,
        },
      };
    } catch {
      return unknown;
    }
  }
}
