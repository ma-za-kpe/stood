import type { VaultAttempt, VaultProvider } from '../../ports/vault-provider.js';
import type { PayPalVaultCall, PayPalVaultTransport } from './sdk.js';

const unknown = Object.freeze({ complete: false });
const object = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(v);
function approval(value: unknown, attempt: VaultAttempt, setupId: string) {
  if (!Array.isArray(value)) return null;
  const links = value.map(object).filter((link) => link?.rel === 'approve');
  if (links.length !== 1 || typeof links[0]?.href !== 'string') return null;
  const href = links[0].href;
  try {
    const url = new URL(href);
    if (
      href.length > 4000 ||
      url.username ||
      url.password ||
      url.hash ||
      (attempt.mode === 'sim'
        ? url.origin !== 'http://paypal-sim:8080' || url.pathname !== `/__sim/setup-approve/${setupId}` || !!url.search
        : url.origin !== 'https://www.sandbox.paypal.com')
    )
      return null;
    return href;
  } catch {
    return null;
  }
}
export class PayPalVaultAdapter implements VaultProvider {
  constructor(private readonly transport: PayPalVaultTransport) {}
  createSetup(attempt: VaultAttempt) {
    return attempt.status === 'CREATING' && !attempt.setupId
      ? this.call('CREATE_SETUP', attempt)
      : Promise.resolve(unknown);
  }
  readSetup(attempt: VaultAttempt, candidateSetupId?: string) {
    const setupId = attempt.setupId ?? candidateSetupId;
    return ['CREATING', 'AWAITING_APPROVAL', 'TOKENIZING'].includes(attempt.status) && id(setupId)
      ? this.call('GET_SETUP', attempt, setupId)
      : Promise.resolve(unknown);
  }
  createToken(attempt: VaultAttempt) {
    return attempt.status === 'TOKENIZING' &&
      id(attempt.setupId) &&
      id(attempt.customerId) &&
      id(attempt.payerId) &&
      !attempt.tokenId
      ? this.call('CREATE_TOKEN', attempt)
      : Promise.resolve(unknown);
  }
  readToken(attempt: VaultAttempt, candidateTokenId?: string) {
    const tokenId = attempt.tokenId ?? candidateTokenId;
    return attempt.status === 'TOKENIZING' &&
      id(attempt.setupId) &&
      id(attempt.customerId) &&
      id(attempt.payerId) &&
      id(tokenId)
      ? this.call('GET_TOKEN', attempt, attempt.setupId, tokenId)
      : Promise.resolve(unknown);
  }
  private async call(
    action: PayPalVaultCall,
    attempt: VaultAttempt,
    setupId = attempt.setupId,
    tokenId = attempt.tokenId,
  ): Promise<unknown> {
    try {
      const response = await this.transport.vault(action, {
        mode: attempt.mode,
        requestId: action === 'CREATE_TOKEN' ? attempt.tokenRequestId : attempt.setupRequestId,
        customerRef: attempt.customerRef,
        setupId,
        tokenId,
        customerId: attempt.customerId,
      });
      if (action.startsWith('GET_') ? response.status !== 200 : ![200, 201].includes(response.status ?? 0))
        return unknown;
      const body = object(response.body),
        customer = object(body?.customer),
        source = object(body?.payment_source),
        paypal = object(source?.paypal);
      if (
        !body ||
        !id(body.id) ||
        !id(customer?.id) ||
        customer.merchant_customer_id !== attempt.customerRef ||
        (attempt.customerId && customer.id !== attempt.customerId) ||
        !paypal ||
        Object.keys(source!).some((k) => k !== 'paypal')
      )
        return unknown;
      const identity = {
        complete: true,
        key: attempt.key,
        platformId: attempt.platformId,
        allowanceId: attempt.allowanceId,
        termsVersion: attempt.termsVersion,
        termsHash: attempt.termsHash,
        setupRequestId: attempt.setupRequestId,
        tokenRequestId: attempt.tokenRequestId,
        customerRef: attempt.customerRef,
        customerId: customer.id,
      };
      if (action === 'CREATE_TOKEN' || action === 'GET_TOKEN') {
        if (
          (tokenId && body.id !== tokenId) ||
          !id(paypal.payer_id) ||
          paypal.payer_id !== attempt.payerId ||
          (body.status !== undefined && !['VAULTED', 'TOKENIZED'].includes(String(body.status)))
        )
          return unknown;
        return { ...identity, outcome: 'TOKENIZED', setupId, tokenId: body.id, payerId: paypal.payer_id };
      }
      if (
        (setupId && body.id !== setupId) ||
        !['CREATED', 'PAYER_ACTION_REQUIRED', 'APPROVED'].includes(String(body.status))
      )
        return unknown;
      if (body.status === 'APPROVED') {
        if (!id(paypal.payer_id) || (attempt.payerId && paypal.payer_id !== attempt.payerId)) return unknown;
        return { ...identity, outcome: 'APPROVED', setupId: body.id, payerId: paypal.payer_id };
      }
      const approvalUrl = approval(body.links, attempt, body.id);
      if (!approvalUrl || (attempt.approvalUrl && approvalUrl !== attempt.approvalUrl)) return unknown;
      return { ...identity, outcome: 'CREATED', setupId: body.id, approvalUrl };
    } catch {
      return unknown;
    }
  }
}
