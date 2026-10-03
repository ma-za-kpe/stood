import { describe, expect, it } from 'vitest';
import { classifyPaymentFailure, classifyReauthorizationFailure } from './classify-failure.js';

const error = (issue: string) => ({
  name: 'UNPROCESSABLE_ENTITY',
  message: 'Synthetic error',
  debug_id: 'debug_fixture',
  details: [{ issue }],
});
describe('PayPal failure classification (T-0129, synthetic contracts)', () => {
  it('maps only documented endpoint-specific rejections', () => {
    expect(classifyPaymentFailure('CAPTURE', 422, error('AUTHORIZATION_EXPIRED'))).toEqual({
      kind: 'AUTHORIZATION_EXPIRED',
      reference: 'debug_fixture',
    });
    expect(classifyPaymentFailure('CAPTURE', 422, error('MAX_CAPTURE_AMOUNT_EXCEEDED'))).toEqual({
      kind: 'REJECTED_NO_PAYMENT',
      reference: 'debug_fixture',
    });
    for (const issue of ['AUTH_CURRENCY_MISMATCH', 'REAUTHORIZATION_TOO_SOON']) {
      expect(classifyReauthorizationFailure(422, error(issue))).toEqual({
        effect: 'REAUTHORIZE',
        kind: 'REJECTED_NO_REAUTHORIZATION',
        reference: 'debug_fixture',
      });
      expect(classifyPaymentFailure('CAPTURE', 422, error(issue)).kind).toBe('AMBIGUOUS');
    }
    expect(classifyPaymentFailure('VOID', 422, error('PREVIOUSLY_CAPTURED')).kind).toBe('AMBIGUOUS');
    expect(classifyPaymentFailure('VOID', 422, error('AUTHORIZATION_EXPIRED')).kind).toBe('AMBIGUOUS');
  });
  it('keeps reauthorisation outcomes separate and uncertain unless definitely rejected', () => {
    for (const [status, body] of [
      [null, null],
      [500, error('REAUTHORIZATION_TOO_SOON')],
      [422, error('AUTHORIZATION_EXPIRED')],
      [422, error('UNKNOWN')],
      [
        422,
        { ...error('AUTH_CURRENCY_MISMATCH'), details: [{ issue: 'AUTH_CURRENCY_MISMATCH' }, { issue: 'UNKNOWN' }] },
      ],
      [201, { id: 'auth_new', status: 'CREATED' }],
    ] as const)
      expect(classifyReauthorizationFailure(status, body)).toEqual({
        effect: 'REAUTHORIZE',
        kind: 'AMBIGUOUS',
        reference: null,
      });
    expect(classifyPaymentFailure('REAUTHORIZE' as 'CAPTURE', 422, error('REAUTHORIZATION_TOO_SOON')).kind).toBe(
      'AMBIGUOUS',
    );
  });
  it('recognises a terminal declined capture resource with a reference', () => {
    for (const status of [200, 201])
      expect(classifyPaymentFailure('CAPTURE', status, { id: 'capture_fixture', status: 'DECLINED' })).toEqual({
        kind: 'DECLINED',
        reference: 'capture_fixture',
      });
    expect(classifyPaymentFailure('VOID', 201, { id: 'capture_fixture', status: 'DECLINED' }).kind).toBe('AMBIGUOUS');
    expect(classifyPaymentFailure('CAPTURE', 201, { status: 'DECLINED' }).kind).toBe('AMBIGUOUS');
    expect(classifyPaymentFailure('CAPTURE', 201, { id: '', status: 'DECLINED' }).kind).toBe('AMBIGUOUS');
    expect(classifyPaymentFailure('CAPTURE', 201, { id: 'capture_fixture', status: 'PENDING' }).kind).toBe('AMBIGUOUS');
  });
  it('keeps transport errors, server errors and unknown outcomes pending', () => {
    for (const status of [null, 500, 502, 503, 401, 403, 404, 409, 429, Number.NaN]) {
      expect(classifyPaymentFailure('CAPTURE', status, error('AUTHORIZATION_EXPIRED'))).toEqual({
        kind: 'AMBIGUOUS',
        reference: null,
      });
    }
    expect(classifyPaymentFailure('CAPTURE', 422, error('UNKNOWN'))).toEqual({ kind: 'AMBIGUOUS', reference: null });
    expect(classifyPaymentFailure('UNKNOWN' as 'CAPTURE', 422, error('AUTHORIZATION_EXPIRED')).kind).toBe('AMBIGUOUS');
  });
  it('fails closed on malformed, mixed or incomplete error bodies', () => {
    for (const body of [
      null,
      [],
      1,
      {},
      { ...error('AUTHORIZATION_EXPIRED'), debug_id: '' },
      { ...error('AUTHORIZATION_EXPIRED'), name: 'OTHER' },
      { ...error('AUTHORIZATION_EXPIRED'), message: undefined },
      { ...error('AUTHORIZATION_EXPIRED'), details: [] },
      { ...error('AUTHORIZATION_EXPIRED'), details: null },
      { ...error('AUTHORIZATION_EXPIRED'), details: [null] },
      { ...error('AUTHORIZATION_EXPIRED'), details: [{ issue: 1 }] },
      { ...error('AUTHORIZATION_EXPIRED'), details: [{ issue: 'AUTHORIZATION_EXPIRED' }, { issue: 'UNKNOWN' }] },
      {
        ...error('AUTHORIZATION_EXPIRED'),
        details: [{ issue: 'AUTHORIZATION_EXPIRED' }, { issue: 'MAX_CAPTURE_AMOUNT_EXCEEDED' }],
      },
    ]) {
      expect(classifyPaymentFailure('CAPTURE', 422, body).kind).toBe('AMBIGUOUS');
    }
    expect(
      classifyPaymentFailure('CAPTURE', 422, {
        ...error('AUTHORIZATION_EXPIRED'),
        details: [{ issue: 'AUTHORIZATION_EXPIRED' }, { issue: 'AUTHORIZATION_EXPIRED' }],
      }).kind,
    ).toBe('AUTHORIZATION_EXPIRED');
  });
});
