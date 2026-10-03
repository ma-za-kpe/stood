import { type Decision, getProfile, RULE_SET_VERSION } from './decision.js';
import type { Money } from './money.js';
import type { Nonce } from './nonce.js';

export type TrancheState =
  | 'PENDING'
  | 'WAIT_FUNDING'
  | 'HELD'
  | 'DECIDING'
  | 'WAITING'
  | 'CAPTURE_PENDING'
  | 'VOID_PENDING'
  | 'RELEASED'
  | 'REFUSED'
  | 'EXPIRED'
  | 'DISPUTED';
export type HoldAttempt = Readonly<{ authorizationId: string; nonce: string; heldAt: number; expiresAt: number }>;
export type PaymentOperation = Readonly<{
  key: string;
  effect: 'CAPTURE' | 'VOID';
  authorizationId: string;
  target: 'RELEASED' | 'REFUSED' | 'EXPIRED';
}>;
type DecisionRecord = Readonly<{ id: string; decision: Decision }>;
export type SettlementConfirmation = Readonly<{
  effect: 'CAPTURE' | 'VOID';
  authorizationId: string;
  reference: string;
}>;
export type SettlementFailure = Readonly<{
  kind: 'AMBIGUOUS' | 'DECLINED' | 'SYSTEM_FAULT' | 'AUTHORIZATION_EXPIRED';
  effect: 'CAPTURE' | 'VOID';
  authorizationId: string;
  reference?: string;
}>;
type Settlement = Readonly<{ effect: 'CAPTURE' | 'VOID' | 'EXPIRE'; reference: string; attempt: number }>;

export class Tranche {
  #state: TrancheState = 'PENDING';
  #attempts: HoldAttempt[] = [];
  #decisions: DecisionRecord[] = [];
  #pending: PaymentOperation | null = null;
  #settlement: Settlement | null = null;
  #settlements: Settlement[] = [];

  constructor(
    readonly id: string,
    readonly amount: Money,
    readonly profileId: string,
    readonly maxResubmits: number,
  ) {
    if (!id.trim() || amount.minor === 0n || !Number.isInteger(maxResubmits) || maxResubmits < 0 || maxResubmits > 5) {
      throw new RangeError('Invalid tranche');
    }
    getProfile(profileId);
    Object.freeze(this);
  }

  get state(): TrancheState {
    return this.#state;
  }
  get attempts(): readonly HoldAttempt[] {
    return Object.freeze([...this.#attempts]);
  }
  get decisions(): readonly DecisionRecord[] {
    return Object.freeze([...this.#decisions]);
  }
  get settlement(): Settlement | null {
    return this.#settlement;
  }
  get settlements(): readonly Settlement[] {
    return Object.freeze([...this.#settlements]);
  }
  get pendingOperation(): PaymentOperation | null {
    return this.#pending;
  }
  get currentHold(): HoldAttempt {
    const hold = this.#attempts.at(-1);
    if (!hold) throw new Error('No confirmed hold');
    return hold;
  }

  fundingFailed(): void {
    this.requireState(['PENDING', 'WAIT_FUNDING']);
    this.#state = 'WAIT_FUNDING';
  }

  dispatch(authorizationId: string, nonce: Nonce, heldAt: number, expiresAt: number): void {
    this.requireState(['PENDING', 'WAIT_FUNDING']);
    if (
      !authorizationId.trim() ||
      !Number.isFinite(heldAt) ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= heldAt ||
      expiresAt - heldAt > 29 * 86400000 ||
      this.#attempts.some((a) => a.authorizationId === authorizationId)
    )
      throw new RangeError('Invalid authorisation');
    this.#attempts.push(Object.freeze({ authorizationId, nonce: nonce.value, heldAt, expiresAt }));
    this.#state = 'HELD';
  }

  startDeciding(): void {
    this.requireState(['HELD']);
    this.#state = 'DECIDING';
  }

  beginSettlement(decision: Decision, decisionId: string, now: number): PaymentOperation | null {
    this.requireState(['DECIDING', 'WAITING']);
    const profile = getProfile(this.profileId);
    if (
      !decisionId.trim() ||
      this.#decisions.some((d) => d.id === decisionId) ||
      decision.profileId !== this.profileId ||
      !['RELEASE', 'REFUSE', 'WAIT'].includes(decision.outcome) ||
      decision.ruleSetVersion !== RULE_SET_VERSION ||
      !Number.isFinite(now) ||
      now < this.currentHold.heldAt ||
      !decision.reason.trim() ||
      (decision.outcome === 'REFUSE' && !decision.namedField?.trim()) ||
      (decision.outcome === 'RELEASE' && decision.effect !== profile.passEffect) ||
      (decision.outcome === 'REFUSE' && (profile.failEffect !== 'VOID' || decision.effect !== 'VOID')) ||
      (decision.outcome === 'WAIT' && decision.effect !== 'NONE')
    )
      throw new Error('Invalid decision');
    this.#decisions.push(Object.freeze({ id: decisionId, decision: Object.freeze({ ...decision }) }));
    if (now >= this.currentHold.expiresAt) return this.reserve('VOID', 'EXPIRED');
    if (decision.outcome === 'WAIT') {
      this.#state = 'WAITING';
      return null;
    }
    return this.reserve(decision.effect as 'CAPTURE' | 'VOID', decision.outcome === 'RELEASE' ? 'RELEASED' : 'REFUSED');
  }

  confirmSettlement(confirmation: SettlementConfirmation): void {
    const pending = this.matchPending(confirmation);
    if (!confirmation.reference.trim()) throw new Error('Payment confirmation requires a reference');
    this.#settlement = Object.freeze({
      effect: pending.effect,
      reference: confirmation.reference,
      attempt: this.#attempts.length,
    });
    this.#settlements.push(this.#settlement);
    this.#state = pending.target;
    this.#pending = null;
  }

  settlementFailed(failure: SettlementFailure): void {
    this.matchPending(failure);
    if (!['AMBIGUOUS', 'DECLINED', 'SYSTEM_FAULT', 'AUTHORIZATION_EXPIRED'].includes(failure.kind))
      throw new Error('Unknown settlement failure');
    if (failure.kind === 'AMBIGUOUS') return;
    if (failure.kind === 'AUTHORIZATION_EXPIRED') {
      if (!failure.reference?.trim()) throw new Error('Confirmed expiration requires a provider reference');
      this.#settlement = Object.freeze({
        effect: 'EXPIRE',
        reference: failure.reference,
        attempt: this.#attempts.length,
      });
      this.#settlements.push(this.#settlement);
      this.#state = 'EXPIRED';
    } else {
      this.#state = 'WAITING';
    }
    this.#pending = null;
  }

  private matchPending(result: Pick<SettlementConfirmation, 'effect' | 'authorizationId'>): PaymentOperation {
    this.requireState(['CAPTURE_PENDING', 'VOID_PENDING']);
    const pending = this.#pending as PaymentOperation;
    if (result.effect !== pending.effect || result.authorizationId !== pending.authorizationId)
      throw new Error('Settlement does not match the pending operation');
    return pending;
  }

  expire(now: number): PaymentOperation {
    this.requireState(['HELD', 'DECIDING', 'WAITING']);
    if (!Number.isFinite(now) || now < this.currentHold.expiresAt) throw new Error('Hold has not expired');
    return this.reserve('VOID', 'EXPIRED');
  }

  redispatch(): void {
    this.requireState(['REFUSED']);
    if (this.#attempts.length >= this.maxResubmits + 1) throw new Error('Resubmission limit reached');
    this.#settlement = null;
    this.#state = 'PENDING';
  }

  dispute(): void {
    this.requireState(['RELEASED']);
    this.#state = 'DISPUTED';
  }

  private reserve(effect: 'CAPTURE' | 'VOID', target: PaymentOperation['target']): PaymentOperation {
    this.#pending = Object.freeze({
      key: `${this.id}:${this.#attempts.length}:${effect}`,
      effect,
      authorizationId: this.currentHold.authorizationId,
      target,
    });
    this.#state = effect === 'CAPTURE' ? 'CAPTURE_PENDING' : 'VOID_PENDING';
    return this.#pending;
  }

  private requireState(allowed: readonly TrancheState[]): void {
    if (!allowed.includes(this.#state)) throw new Error(`Invalid transition from ${this.#state}`);
  }
}
