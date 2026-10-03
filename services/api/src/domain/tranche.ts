import { type Decision, getProfile } from './decision.js';
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
type Settlement = Readonly<{ effect: 'CAPTURE' | 'VOID'; reference: string; attempt: number }>;

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

  beginSettlement(decision: Decision, decisionId: string): PaymentOperation | null {
    this.requireState(['DECIDING', 'WAITING']);
    const profile = getProfile(this.profileId);
    if (
      !decisionId.trim() ||
      this.#decisions.some((d) => d.id === decisionId) ||
      decision.profileId !== this.profileId ||
      !['RELEASE', 'REFUSE', 'WAIT'].includes(decision.outcome) ||
      decision.ruleSetVersion !== '1.0.0' ||
      !decision.reason.trim() ||
      (decision.outcome === 'REFUSE' && !decision.namedField?.trim()) ||
      (decision.outcome === 'RELEASE' && decision.effect !== profile.passEffect) ||
      (decision.outcome === 'REFUSE' && (profile.failEffect !== 'VOID' || decision.effect !== 'VOID')) ||
      (decision.outcome === 'WAIT' && decision.effect !== 'NONE')
    )
      throw new Error('Invalid decision');
    this.#decisions.push(Object.freeze({ id: decisionId, decision: Object.freeze({ ...decision }) }));
    if (decision.outcome === 'WAIT') {
      this.#state = 'WAITING';
      return null;
    }
    return this.reserve(decision.effect as 'CAPTURE' | 'VOID', decision.outcome === 'RELEASE' ? 'RELEASED' : 'REFUSED');
  }

  confirmSettlement(reference: string): void {
    this.requireState(['CAPTURE_PENDING', 'VOID_PENDING']);
    if (!reference.trim()) throw new Error('Payment confirmation requires a reference');
    const pending = this.#pending as PaymentOperation;
    this.#settlement = Object.freeze({ effect: pending.effect, reference, attempt: this.#attempts.length });
    this.#settlements.push(this.#settlement);
    this.#state = pending.target;
    this.#pending = null;
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
