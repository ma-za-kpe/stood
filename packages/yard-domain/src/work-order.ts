export const WORK_ORDER_TRANSITIONS = Object.freeze({
  CLAIMED: Object.freeze(['POSTED']),
  BUILDING: Object.freeze(['CLAIMED', 'REWORK']),
  SUBMITTED: Object.freeze(['BUILDING']),
  CHECKING: Object.freeze(['SUBMITTED']),
  REWORK: Object.freeze(['CHECKING']),
  ABANDONED: Object.freeze(['CLAIMED', 'BUILDING', 'REWORK']),
  LEASE_EXPIRED: Object.freeze(['CLAIMED', 'BUILDING', 'REWORK']),
  POSTED: Object.freeze(['LEASE_EXPIRED', 'ABANDONED']),
});
export const LEASE_MS = 48 * 3600000;
export type ClaimInput = Readonly<{ id: string; builderId: string; operatorId: string; operatorRootId: string }>;
export type Claim = ClaimInput &
  Readonly<{
    claimedAt: number;
    leasedUntil: number;
    outsideOperator: boolean;
    status: 'ACTIVE' | 'EXPIRED' | 'RELEASED';
  }>;
type State = 'POSTED' | 'CLAIMED' | 'BUILDING' | 'SUBMITTED' | 'CHECKING' | 'REWORK' | 'LEASE_EXPIRED' | 'ABANDONED';
type Snapshot = Readonly<{
  id: string;
  state: State;
  version: number;
  lastAt: number;
  attempt: number;
  claims: readonly Claim[];
  currentClaim: Claim | null;
  submission: Readonly<{ commit: string; packageId: string; claimId: string }> | null;
}>;
const text = (s: string) => typeof s === 'string' && s.trim().length > 0 && s.length <= 200;
// Authenticated operator roots must come from the Board's identity registry.
// This lease aggregate cannot decide payment or confirm a PayPal hold.
export class WorkOrder {
  #snapshot: Snapshot;
  constructor(
    id: string,
    private readonly buyerOperatorRootId: string,
    postedAt: number,
  ) {
    if (!text(id) || !text(buyerOperatorRootId) || !Number.isSafeInteger(postedAt))
      throw new RangeError('Invalid work order');
    this.#snapshot = Object.freeze({
      id,
      state: 'POSTED',
      version: 0,
      lastAt: postedAt,
      attempt: 1,
      claims: Object.freeze([]),
      currentClaim: null,
      submission: null,
    });
  }
  get snapshot(): Snapshot {
    return this.#snapshot;
  }
  private clock(now: number): void {
    if (!Number.isSafeInteger(now) || now < this.#snapshot.lastAt || now > Number.MAX_SAFE_INTEGER - LEASE_MS)
      throw new RangeError('Invalid work-order clock');
  }
  private commit(now: number, patch: Partial<Snapshot>): void {
    this.#snapshot = Object.freeze({ ...this.#snapshot, ...patch, lastAt: now, version: this.#snapshot.version + 1 });
  }
  claim(input: ClaimInput, now: number): Claim {
    this.clock(now);
    if (![input.id, input.builderId, input.operatorId, input.operatorRootId].every(text))
      throw new RangeError('Invalid builder identity');
    const current = this.#snapshot.currentClaim;
    if (current) {
      if (
        current.leasedUntil > now &&
        ['CLAIMED', 'BUILDING'].includes(this.#snapshot.state) &&
        current.id === input.id &&
        current.builderId === input.builderId &&
        current.operatorId === input.operatorId &&
        current.operatorRootId === input.operatorRootId
      )
        return current;
      throw new Error('Work order already has a claim');
    }
    if (
      !WORK_ORDER_TRANSITIONS.CLAIMED.includes(this.#snapshot.state) ||
      this.#snapshot.claims.some((c) => c.id === input.id)
    )
      throw new Error('Claim cannot be reused');
    const claim: Claim = Object.freeze({
      id: input.id,
      builderId: input.builderId,
      operatorId: input.operatorId,
      operatorRootId: input.operatorRootId,
      claimedAt: now,
      leasedUntil: now + LEASE_MS,
      outsideOperator: input.operatorRootId !== this.buyerOperatorRootId,
      status: 'ACTIVE',
    });
    this.commit(now, {
      state: 'CLAIMED',
      currentClaim: claim,
      claims: Object.freeze([...this.#snapshot.claims, claim]),
    });
    return claim;
  }
  private active(id: string, now: number): Claim {
    this.clock(now);
    const claim = this.#snapshot.currentClaim;
    if (!claim || claim.id !== id || now >= claim.leasedUntil) throw new Error('No matching active lease');
    return claim;
  }
  build(claimId: string, now: number): void {
    this.active(claimId, now);
    if (!WORK_ORDER_TRANSITIONS.BUILDING.includes(this.#snapshot.state)) throw new Error('Cannot start build');
    this.commit(now, { state: 'BUILDING' });
  }
  submit(claimId: string, commit: string, packageId: string, now: number): void {
    this.active(claimId, now);
    if (
      !WORK_ORDER_TRANSITIONS.SUBMITTED.includes(this.#snapshot.state) ||
      !/^[a-f0-9]{40}$/.test(commit) ||
      !text(packageId)
    )
      throw new Error('Invalid submission');
    this.commit(now, { state: 'SUBMITTED', submission: Object.freeze({ commit, packageId, claimId }) });
  }
  checking(packageId: string, now: number): void {
    this.clock(now);
    if (
      !WORK_ORDER_TRANSITIONS.CHECKING.includes(this.#snapshot.state) ||
      this.#snapshot.submission?.packageId !== packageId
    )
      throw new Error('No matching submitted package');
    this.commit(now, { state: 'CHECKING' });
  }
  // Entered only from a verified Stood refusal of this exact package. It is a
  // build state: the punch list belongs to the projection, never to this aggregate.
  rework(packageId: string, now: number): void {
    this.clock(now);
    if (
      !WORK_ORDER_TRANSITIONS.REWORK.includes(this.#snapshot.state) ||
      !this.#snapshot.currentClaim ||
      this.#snapshot.submission?.packageId !== packageId
    )
      throw new Error('No matching checked package');
    this.commit(now, { state: 'REWORK', submission: null, attempt: this.#snapshot.attempt + 1 });
  }
  release(claimId: string, now: number): void {
    const claim = this.active(claimId, now);
    if (!WORK_ORDER_TRANSITIONS.ABANDONED.includes(this.#snapshot.state))
      throw new Error('Cannot clock out during a check');
    this.close(now, claim, 'RELEASED', 'ABANDONED');
  }
  expire(now: number): void {
    this.clock(now);
    const claim = this.#snapshot.currentClaim;
    if (!claim || !WORK_ORDER_TRANSITIONS.LEASE_EXPIRED.includes(this.#snapshot.state) || now < claim.leasedUntil)
      throw new Error('Lease cannot expire during unresolved submission');
    this.close(now, claim, 'EXPIRED', 'LEASE_EXPIRED');
  }
  private close(now: number, claim: Claim, status: 'EXPIRED' | 'RELEASED', state: 'LEASE_EXPIRED' | 'ABANDONED'): void {
    this.commit(now, {
      state,
      currentClaim: null,
      claims: Object.freeze(
        this.#snapshot.claims.map((c) => (c.id === claim.id ? Object.freeze({ ...c, status }) : c)),
      ),
    });
  }
  repost(now: number): void {
    this.clock(now);
    if (!WORK_ORDER_TRANSITIONS.POSTED.includes(this.#snapshot.state)) throw new Error('Work order cannot be reposted');
    this.commit(now, { state: 'POSTED' });
  }
}
