import type { FundingProvider, SavedPaymentTokens } from '../../ports/funding-provider.js';
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
  vaultId: string | null = null,
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
    ...(vaultId ? { vaultId } : {}),
  };
}
export class PayPalFundingAdapter implements FundingProvider {
  constructor(
    private readonly transport: PayPalFundingTransport,
    private readonly tokens?: SavedPaymentTokens,
  ) {}
  async create(operation: FundingOperation) {
    if (operation.status !== 'CREATING' || operation.orderId) return unknown;
    // T-0295: Stood sends payee_ref to PayPal as the payee merchant. One that cannot be a merchant id is refused here,
    // before any call, instead of PayPal's refusal leaving the funding pending.
    if (operation.instruction.mode === 'live' && !/^[A-Z0-9]{13}$/.test(operation.instruction.payeeRef))
      return {
        complete: true,
        key: operation.key,
        trancheId: operation.trancheId,
        createRequestId: operation.createRequestId,
        authorizeRequestId: operation.authorizeRequestId,
        outcome: 'REJECTED',
        reference: 'payee_not_a_paypal_merchant',
      };
    if (operation.instruction.source !== 'SAVED_PAYPAL') return this.call('CREATE_ORDER', operation);
    // T-0154: no signed mandate token, no call. The token goes to PayPal and nowhere else.
    try {
      const token = await this.tokens?.tokenFor(structuredClone(operation.instruction));
      return text(token) ? this.call('CREATE_ORDER', operation, operation.orderId, token) : unknown;
    } catch {
      return unknown;
    }
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
    vaultId: string | null = null,
  ): Promise<unknown> {
    // With a saved account PayPal authorizes at create, so create answers like authorize does.
    const saved = operation.instruction.source === 'SAVED_PAYPAL';
    const authorizes = action === 'AUTHORIZE_ORDER' || (saved && action === 'CREATE_ORDER');
    try {
      const request = input(operation, action, orderId, vaultId),
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
        authorizes &&
        response.status === 422 &&
        body?.name === 'UNPROCESSABLE_ENTITY' &&
        text(body.message) &&
        text(body.debug_id) &&
        Array.isArray(body.details) &&
        body.details.length > 0 &&
        body.details.every((d) => object(d)?.issue === 'INSTRUMENT_DECLINED')
      )
        return { ...identity, orderId, outcome: 'DECLINED', reference: body.debug_id };
      // T-0295: PayPal refused the create itself (400/422 with its debug id): no order exists, so it is final.
      if (
        action === 'CREATE_ORDER' &&
        !orderId &&
        (response.status === 400 || response.status === 422) &&
        text(body?.debug_id)
      )
        return { ...identity, outcome: 'REJECTED', reference: body.debug_id };
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
        payments = object(unit?.payments),
        // T-0295 (found live): PayPal leaves `captures` out when nothing is captured; an absent list is empty.
        captures = payments && payments.captures === undefined ? [] : payments?.captures;
      if (
        unit?.reference_id !== operation.key ||
        unit.custom_id !== operation.trancheId ||
        object(unit.payee)?.merchant_id !== operation.instruction.payeeRef ||
        !amountMatches(unit.amount, request)
      )
        return unknown;
      if (body.status === 'CREATED' || body.status === 'APPROVED') {
        if (
          saved ||
          action === 'AUTHORIZE_ORDER' ||
          (payments &&
            (!Array.isArray(payments.authorizations) ||
              payments.authorizations.length ||
              !Array.isArray(captures) ||
              captures.length))
        )
          return unknown;
        const url = operation.approvalUrl ?? approval(body.links, operation, body.id);
        if (!url) return unknown;
        return { ...identity, outcome: body.status, orderId: body.id, approvalUrl: url };
      }
      if (
        (action === 'CREATE_ORDER' && !saved) ||
        body.status !== 'COMPLETED' ||
        !Array.isArray(payments?.authorizations) ||
        payments.authorizations.length !== 1 ||
        !Array.isArray(captures) ||
        captures.length
      )
        return unknown;
      const authorization = object(payments.authorizations[0]);
      if (
        !text(authorization?.id) ||
        !['CREATED', 'EXPIRED'].includes(String(authorization?.status)) ||
        (authorization?.status === 'EXPIRED' && action !== 'GET_FUNDING_ORDER') ||
        !amountMatches(authorization.amount, request) ||
        // The authorization sits in this order's own purchase unit; a related order id, when PayPal gives one, must
        // be this order (PayPal omits it on a saved-account create).
        ![undefined, body.id].includes(
          object(object(authorization.supplementary_data)?.related_ids)?.order_id as string,
        ) ||
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
