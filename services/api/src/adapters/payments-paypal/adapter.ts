import { advanceTrancheRecord, restoreTrancheRecord } from '../../domain/tranche-record.js';
import type { PaymentExecutor, PaymentResult } from '../../ports/payment-executor.js';
import type { StoredOperation } from '../../ports/payment-operation-store.js';
import type { ProviderStatusReader } from '../../ports/provider-status-reader.js';
import type { StoredTranche, TrancheStore } from '../../ports/tranche-store.js';
import { classifyPaymentFailure, classifyReauthorizationFailure } from './classify-failure.js';
import type { PayPalInput, PayPalTransport } from './sdk.js';

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as ObjectValue) : null;
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const unknown = Object.freeze({ complete: false });
function inputFor(snapshot: StoredTranche): PayPalInput | null {
  const pending = snapshot.pending;
  if (!pending || !['RESERVED', 'AMBIGUOUS'].includes(pending.status)) return null;
  const tranche = restoreTrancheRecord(snapshot.record);
  const amount = tranche.amount;
  return {
    authorizationId: pending.operation.authorizationId,
    requestId: pending.providerRequestId,
    operationKey: pending.operation.key,
    amount: {
      currencyCode: amount.currency,
      value: `${amount.minor / 100n}.${String(amount.minor % 100n).padStart(2, '0')}`,
    },
  };
}
function matchesAmount(value: unknown, input: PayPalInput): boolean {
  const amount = object(value);
  return amount?.currency_code === input.amount.currencyCode && amount?.value === input.amount.value;
}
function captureMatches(capture: ObjectValue, input: PayPalInput): boolean {
  const related = object(object(capture.supplementary_data)?.related_ids);
  return (
    text(capture.id) &&
    capture.invoice_id === input.operationKey &&
    related?.authorization_id === input.authorizationId &&
    matchesAmount(capture.amount, input)
  );
}
export class PayPalAdapter implements PaymentExecutor, ProviderStatusReader {
  constructor(
    private readonly transport: PayPalTransport,
    private readonly store: Pick<TrancheStore, 'load'>,
  ) {}
  async execute(snapshot: StoredTranche): Promise<PaymentResult | null> {
    const input = inputFor(snapshot);
    const pending = snapshot.pending;
    const tranche = restoreTrancheRecord(snapshot.record);
    if (
      !input ||
      !pending ||
      !tranche.canSubmitPendingOperation ||
      (tranche.profileId === 'rental.return@1' && tranche.pendingOperation?.target === 'RELEASED')
    )
      return null;
    try {
      const operation = pending.operation;
      const response = await this.transport.call(operation.effect, input);
      const body = object(response.body);
      const identity = { effect: operation.effect, authorizationId: operation.authorizationId };
      let result: PaymentResult | null = null;
      if (
        operation.effect === 'CAPTURE' &&
        (response.status === 200 || response.status === 201) &&
        body?.status === 'COMPLETED' &&
        captureMatches(body, input)
      )
        result = {
          method: 'confirmSettlement',
          args: [{ ...identity, effect: 'CAPTURE', reference: body.id as string }],
        };
      else if (operation.effect === 'REAUTHORIZE') {
        if (
          (response.status === 200 || response.status === 201) &&
          body?.status === 'CREATED' &&
          text(body.id) &&
          matchesAmount(body.amount, input) &&
          typeof body.create_time === 'string' &&
          typeof body.expiration_time === 'string'
        )
          result = {
            method: 'confirmReauthorization',
            args: [
              {
                effect: 'REAUTHORIZE',
                key: operation.key,
                previousAuthorizationId: operation.authorizationId,
                authorizationId: body.id,
                confirmedAt: Date.parse(body.create_time),
                expiresAt: Date.parse(body.expiration_time),
              },
            ],
          };
        else {
          const failure = classifyReauthorizationFailure(response.status, response.body);
          if (failure.kind !== 'AMBIGUOUS' && failure.reference)
            result = {
              method: 'reauthorizationFailed',
              args: [
                {
                  ...identity,
                  effect: 'REAUTHORIZE',
                  key: operation.key,
                  kind: failure.kind,
                  reference: failure.reference,
                },
              ],
            };
        }
      } else {
        const failure = classifyPaymentFailure(operation.effect, response.status, response.body);
        if (failure.kind !== 'AMBIGUOUS' && failure.reference)
          result = {
            method: 'settlementFailed',
            args: [{ ...identity, effect: operation.effect, kind: failure.kind, reference: failure.reference }],
          };
      }
      if (result) advanceTrancheRecord(snapshot.record, result);
      return result;
    } catch {
      return null;
    }
  }
  async read(operation: StoredOperation): Promise<unknown> {
    try {
      const snapshot = await this.store.load(operation.trancheId);
      const pending = snapshot.pending;
      const input = inputFor(snapshot);
      if (
        !input ||
        !pending ||
        pending.operation.key !== operation.operation.key ||
        pending.providerRequestId !== operation.providerRequestId
      )
        return unknown;
      const authResponse = await this.transport.call('GET_AUTHORIZATION', input);
      const authorization = object(authResponse.body);
      const orderId = object(object(authorization?.supplementary_data)?.related_ids)?.order_id;
      if (
        authResponse.status !== 200 ||
        authorization?.id !== input.authorizationId ||
        !text(orderId) ||
        !matchesAmount(authorization.amount, input)
      )
        return unknown;
      const orderResponse = await this.transport.call('GET_ORDER', { ...input, authorizationId: orderId });
      const order = object(orderResponse.body);
      if (
        orderResponse.status !== 200 ||
        order?.id !== orderId ||
        !['APPROVED', 'COMPLETED'].includes(String(order.status)) ||
        !Array.isArray(order.purchase_units) ||
        order.purchase_units.length !== 1
      )
        return unknown;
      const unit = object(order.purchase_units[0]);
      const payments = object(unit?.payments);
      if (
        unit?.custom_id !== operation.trancheId ||
        !matchesAmount(unit.amount, input) ||
        !Array.isArray(payments?.authorizations) ||
        !Array.isArray(payments.captures)
      )
        return unknown;
      const authorizations = payments.authorizations.map(object);
      if (
        !authorizations.some((auth) => auth?.id === input.authorizationId) ||
        authorizations.some((auth) => !text(auth?.id))
      )
        return unknown;
      const tranche = restoreTrancheRecord(snapshot.record);
      const known = new Set([
        ...tranche.attempts.map((hold) => hold.authorizationId),
        ...tranche.reauthorizations.map((renewal) => renewal.authorizationId),
      ]);
      const renewed = authorizations.filter((auth) => !known.has(auth?.id as string));
      const proof = {
        complete: true,
        operationKey: input.operationKey,
        authorizationId: input.authorizationId,
        providerRequestId: input.requestId,
        reference: `${orderId}:${input.authorizationId}`,
        noCapture: true,
        noRenewal: renewed.length === 0,
      };
      if (payments.captures.length) {
        const capture = object(payments.captures[0]);
        if (
          pending.operation.effect !== 'CAPTURE' ||
          renewed.length ||
          payments.captures.length !== 1 ||
          !capture ||
          !captureMatches(capture, input)
        )
          return unknown;
        if (capture.status === 'COMPLETED' && authorization.status === 'CAPTURED')
          return {
            ...proof,
            reference: capture.id,
            outcome: 'CAPTURED',
            noCapture: false,
            amount: tranche.amount.toJSON(),
          };
        if (capture.status === 'DECLINED' && authorization.status === 'CREATED')
          return { ...proof, reference: capture.id, outcome: 'DECLINED' };
        return unknown;
      }
      if (renewed.length) {
        if (pending.operation.effect !== 'REAUTHORIZE' || renewed.length !== 1 || !renewed[0]) return unknown;
        const response = await this.transport.call('GET_AUTHORIZATION', {
          ...input,
          authorizationId: renewed[0].id as string,
        });
        const body = object(response.body);
        if (
          response.status !== 200 ||
          !body ||
          body.id !== renewed[0].id ||
          body.status !== 'CREATED' ||
          !matchesAmount(body.amount, input) ||
          typeof body.create_time !== 'string' ||
          typeof body.expiration_time !== 'string'
        )
          return unknown;
        return {
          ...proof,
          outcome: 'RENEWED',
          renewed: {
            authorizationId: body.id,
            confirmedAt: Date.parse(body.create_time),
            expiresAt: Date.parse(body.expiration_time),
          },
        };
      }
      if (authorization.status === 'EXPIRED' || authorization.status === 'VOIDED')
        return { ...proof, outcome: authorization.status };
      // Absence of a capture/renewal while still authorised cannot prove a timed-out
      // request never happened. Retain it for later lookup or operator escalation.
      return unknown;
    } catch {
      return unknown;
    }
  }
}
