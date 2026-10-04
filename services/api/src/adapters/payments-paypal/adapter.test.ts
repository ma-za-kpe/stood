import { describe, expect, it, vi } from 'vitest';
import { RULE_SET_VERSION } from '../../domain/decision.js';
import {
  advanceTrancheRecord,
  createTrancheRecord,
  restoreTrancheRecord,
  type TrancheCommand,
} from '../../domain/tranche-record.js';
import type { StoredTranche } from '../../ports/tranche-store.js';
import { PayPalAdapter } from './adapter.js';
import type { PayPalCall } from './sdk.js';

const at = 1790985600000;
const expiry = at + 29 * 86400000;
function fixture(effect: 'CAPTURE' | 'VOID' | 'REAUTHORIZE' = 'CAPTURE') {
  let record = createTrancheRecord({
    id: 'provider',
    amount: { minor: 1000, currency: 'GBP' },
    profileId: 'construction.stage@1',
    maxResubmits: 1,
  });
  record = advanceTrancheRecord(record, { method: 'dispatch', args: ['auth_fixture', 'K7Q', at, expiry] });
  if (effect === 'REAUTHORIZE')
    record = advanceTrancheRecord(record, { method: 'beginReauthorization', args: [at + 3 * 86400000] });
  else {
    record = advanceTrancheRecord(record, { method: 'startDeciding', args: [] });
    record = advanceTrancheRecord(record, {
      method: 'beginSettlement',
      args: [
        {
          outcome: effect === 'CAPTURE' ? 'RELEASE' : 'REFUSE',
          effect,
          reason: 'fixture',
          namedField: effect === 'VOID' ? 'plot' : null,
          detail: null,
          profileId: 'construction.stage@1',
          ruleSetVersion: RULE_SET_VERSION,
        },
        'decision',
        at,
      ],
    });
  }
  const tranche = restoreTrancheRecord(record);
  const operation = tranche.pendingOperation ?? tranche.pendingReauthorization;
  if (!operation) throw new Error('Missing fixture');
  const snapshot: StoredTranche = {
    trancheId: 'provider',
    version: 3,
    record,
    pending: {
      trancheId: 'provider',
      operation,
      providerRequestId: 'persisted_uuid',
      status: 'AMBIGUOUS',
      reference: null,
      version: 3,
      reservedFromVersion: 2,
      createdAt: new Date(at).toISOString(),
    },
  };
  const authorization = {
    id: 'auth_fixture',
    status: 'CAPTURED',
    amount: { currency_code: 'GBP', value: '10.00' },
    supplementary_data: { related_ids: { order_id: 'order_fixture' } },
  };
  const capture = {
    id: 'capture_fixture',
    status: 'COMPLETED',
    invoice_id: operation.key,
    amount: { currency_code: 'GBP', value: '10.00' },
    supplementary_data: { related_ids: { authorization_id: 'auth_fixture' } },
  };
  const unit = {
    custom_id: 'provider',
    amount: { currency_code: 'GBP', value: '10.00' },
    payments: { captures: [capture], authorizations: [{ id: 'auth_fixture' }] },
  };
  const order = { id: 'order_fixture', status: 'COMPLETED', purchase_units: [unit] };
  const call = vi.fn(async (action: PayPalCall, _input: unknown) => ({
    status: 200,
    body: action === 'GET_AUTHORIZATION' ? authorization : action === 'GET_ORDER' ? order : capture,
  }));
  const adapter = new PayPalAdapter({ call }, { load: async () => snapshot });
  return { snapshot, authorization, capture, unit, order, call, adapter };
}
describe('PayPal operation adapter with synthetic REST bodies', () => {
  it('allows rental cancellation to reach the provider instead of stranding a safe-mode hold', async () => {
    const f = fixture('VOID');
    const doc = JSON.parse(f.snapshot.record);
    doc.definition.profileId = 'rental.return@1';
    doc.ruleSetVersion = '1.0.0';
    doc.commands = [doc.commands[0], { method: 'cancel', args: [at] }];
    const record = JSON.stringify(doc);
    const snapshot = {
      ...f.snapshot,
      record,
      pending: { ...f.snapshot.pending!, operation: restoreTrancheRecord(record).pendingOperation! },
    };
    await f.adapter.execute(snapshot);
    expect(f.call).toHaveBeenCalledOnce();
  });
  it('rejects malformed authorisation/order data, unexpected captures and stale caller identity', async () => {
    for (const body of [
      null,
      {},
      { id: 'wrong' },
      { id: 'auth_fixture', amount: { currency_code: 'USD', value: '10.00' } },
    ]) {
      const f = fixture();
      f.call.mockResolvedValue({ status: 200, body: body as never });
      expect(await f.adapter.read(f.snapshot.pending!)).toMatchObject({ complete: false });
    }
    for (const patch of [
      { id: 'wrong' },
      { status: 'CREATED' },
      { purchase_units: [] },
      { purchase_units: [null] },
      { purchase_units: [null, null] },
    ]) {
      const f = fixture();
      Object.assign(f.order, patch);
      expect(await f.adapter.read(f.snapshot.pending!)).toMatchObject({ complete: false });
    }
    const f = fixture();
    f.authorization.status = 'CREATED';
    f.capture.status = 'PENDING';
    expect(await f.adapter.read(f.snapshot.pending!)).toMatchObject({ complete: false });
    f.capture.status = 'DECLINED';
    expect(await f.adapter.read(f.snapshot.pending!)).toMatchObject({ outcome: 'DECLINED' });
    f.unit.payments.captures = [];
    expect(await f.adapter.read(f.snapshot.pending!)).toMatchObject({ complete: false });
    expect(await f.adapter.read({ ...f.snapshot.pending!, providerRequestId: 'wrong' })).toMatchObject({
      complete: false,
    });
    expect(
      await f.adapter.read({ ...f.snapshot.pending!, operation: { ...f.snapshot.pending!.operation, key: 'wrong' } }),
    ).toMatchObject({ complete: false });
  });
  it('discovers renewals by full order lineage rather than a fabricated echoed request ID', async () => {
    const f = fixture('REAUTHORIZE');
    f.unit.payments.captures = [];
    f.unit.payments.authorizations.push({ id: 'renewed' });
    f.call.mockImplementation(async (action, input: unknown) => {
      if (action === 'GET_ORDER') return { status: 200, body: f.order };
      if ((input as { authorizationId: string }).authorizationId === 'renewed')
        return {
          status: 200,
          body: {
            id: 'renewed',
            status: 'CREATED',
            amount: { currency_code: 'GBP', value: '10.00' },
            create_time: new Date(at + 3 * 86400000).toISOString(),
            expiration_time: new Date(expiry).toISOString(),
          } as never,
        };
      return { status: 200, body: f.authorization };
    });
    expect(await f.adapter.read(f.snapshot.pending!)).toMatchObject({
      outcome: 'RENEWED',
      noCapture: true,
      noRenewal: false,
      renewed: { authorizationId: 'renewed' },
    });
    f.unit.payments.authorizations.push({ id: 'other' });
    expect(await f.adapter.read(f.snapshot.pending!)).toMatchObject({ complete: false });
  });
  it('requires a matched completed capture and amount; PENDING remains unresolved', async () => {
    const f = fixture();
    expect(await f.adapter.execute(f.snapshot)).toMatchObject({
      method: 'confirmSettlement',
      args: [{ effect: 'CAPTURE', reference: 'capture_fixture' }],
    });
    expect(f.call).toHaveBeenCalledWith(
      'CAPTURE',
      expect.objectContaining({
        requestId: 'persisted_uuid',
        operationKey: f.snapshot.pending?.operation.key,
        amount: { currencyCode: 'GBP', value: '10.00' },
      }),
    );
    for (const patch of [
      { status: 'PENDING' },
      { invoice_id: 'wrong' },
      { amount: { currency_code: 'USD', value: '10.00' } },
      { amount: { currency_code: 'GBP', value: '10.01' } },
    ]) {
      Object.assign(f.capture, patch);
      expect(await f.adapter.execute(f.snapshot)).toBeNull();
    }
  });
  it('reads correlation from invoice/custom id and related authorisation, without requiring an echoed request UUID', async () => {
    const f = fixture();
    const proof = await f.adapter.read(f.snapshot.pending!);
    expect(proof).toMatchObject({
      complete: true,
      providerRequestId: 'persisted_uuid',
      operationKey: f.snapshot.pending?.operation.key,
      outcome: 'CAPTURED',
      noCapture: false,
      noRenewal: true,
    });
    for (const patch of [{ custom_id: 'other_tranche' }, { payments: { captures: [], authorizations: [] } }]) {
      Object.assign(f.unit, patch);
      expect(await f.adapter.read(f.snapshot.pending!)).toMatchObject({ complete: false });
    }
  });
  it('requires complete no-capture status before confirming a cancellation or expiry', async () => {
    for (const status of ['VOIDED', 'EXPIRED']) {
      const f = fixture('VOID');
      f.authorization.status = status;
      f.unit.payments.captures = [];
      expect(await f.adapter.read(f.snapshot.pending!)).toMatchObject({
        complete: true,
        outcome: status,
        noCapture: true,
        noRenewal: true,
      });
    }
    const f = fixture('VOID');
    f.authorization.status = 'VOIDED';
    expect(await f.adapter.read(f.snapshot.pending!)).toMatchObject({ complete: false });
    f.call.mockImplementation(async () => ({ status: 204, body: null as never }));
    expect(await f.adapter.execute(f.snapshot)).toBeNull();
  });
  it('maps only definite failures and retains unknown SDK responses', async () => {
    const f = fixture();
    f.capture.status = 'DECLINED';
    expect(await f.adapter.execute(f.snapshot)).toMatchObject({
      method: 'settlementFailed',
      args: [{ kind: 'DECLINED' }],
    });
    f.call.mockRejectedValue(new Error('Network'));
    expect(await f.adapter.execute(f.snapshot)).toBeNull();
    expect(await f.adapter.read(f.snapshot.pending!)).toMatchObject({ complete: false });
    for (const status of ['RESERVED', 'CONFIRMED', 'FAILED'] as const) {
      if (status === 'RESERVED') continue;
      expect(await f.adapter.execute({ ...f.snapshot, pending: { ...f.snapshot.pending!, status } })).toBeNull();
    }
    expect(await f.adapter.execute({ ...f.snapshot, pending: null })).toBeNull();
  });
  it('adopts a new authorisation from a matched direct renewal response', async () => {
    const f = fixture('REAUTHORIZE');
    f.call.mockResolvedValue({
      status: 201,
      body: {
        id: 'renewed',
        status: 'CREATED',
        amount: { currency_code: 'GBP', value: '10.00' },
        create_time: new Date(at + 3 * 86400000).toISOString(),
        expiration_time: new Date(expiry).toISOString(),
      } as never,
    });
    expect(await f.adapter.execute(f.snapshot)).toMatchObject({
      method: 'confirmReauthorization',
      args: [{ authorizationId: 'renewed', previousAuthorizationId: 'auth_fixture' }],
    });
  });
});
