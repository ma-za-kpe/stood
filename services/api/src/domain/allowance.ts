import { getProfile } from './decision.js';
import { assertHoldCurrency } from './hold-policy.js';
import { Money } from './money.js';

export type Milestone = Readonly<{ name: string; amount: Money; profileId: string }>;
export type AllowanceInput = Readonly<{
  id: string;
  platformId: string;
  payeeRef: string;
  cap: Money;
  milestones: readonly Milestone[];
  windowDays: number;
  maxResubmits: number;
}>;

// Creation invariants only. Signature, Vault, persistence and HTTP creation are separate work.
export class Allowance {
  readonly status = 'DRAFT';
  readonly id: string;
  readonly platformId: string;
  readonly payeeRef: string;
  readonly cap: Money;
  readonly milestones: readonly Milestone[];
  readonly windowDays: number;
  readonly maxResubmits: number;

  constructor(input: AllowanceInput) {
    assertHoldCurrency(input.cap.currency);
    if (
      !input.id.trim() ||
      !input.platformId.trim() ||
      !input.payeeRef.trim() ||
      input.cap.minor === 0n ||
      !Number.isInteger(input.windowDays) ||
      input.windowDays < 1 ||
      input.windowDays > 28 ||
      !Number.isInteger(input.maxResubmits) ||
      input.maxResubmits < 0 ||
      input.maxResubmits > 5 ||
      !input.milestones.length
    )
      throw new RangeError('Invalid allowance');
    const milestones = input.milestones.map((milestone) => {
      if (!milestone.name.trim() || milestone.amount.minor === 0n) throw new RangeError('Invalid milestone');
      getProfile(milestone.profileId);
      return Object.freeze({ name: milestone.name.trim(), amount: milestone.amount, profileId: milestone.profileId });
    });
    if (new Set(milestones.map((m) => m.name)).size !== milestones.length)
      throw new RangeError('Duplicate milestone name');
    const total = milestones.reduce((sum, milestone) => sum.add(milestone.amount), new Money(0n, input.cap.currency));
    if (total.minor !== input.cap.minor) throw new RangeError('Allowance cap must equal milestone sum');
    this.id = input.id;
    this.platformId = input.platformId;
    this.payeeRef = input.payeeRef;
    this.cap = input.cap;
    this.milestones = Object.freeze(milestones);
    this.windowDays = input.windowDays;
    this.maxResubmits = input.maxResubmits;
    Object.freeze(this);
  }
}
