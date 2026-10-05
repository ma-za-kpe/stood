import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { LEASE_MS, WorkOrder } from './index.js';

const at = 1790985600000;
const builder = { id: 'claim_1', builderId: 'crew_7', operatorId: 'op_1', operatorRootId: 'root_1' };
const order = () => new WorkOrder('wo_1', 'buyer_root', at);
describe('Work-order lease foundation, no money projection (T-0178)', () => {
  it('allows one current claim, with a fixed 48-hour lease and replay that never extends it', () => {
    const wo = order();
    const claim = wo.claim(builder, at);
    expect(claim.leasedUntil).toBe(at + LEASE_MS);
    expect(LEASE_MS).toBe(48 * 3600000);
    expect(wo.claim(builder, at + 1000)).toEqual(claim);
    expect(wo.snapshot.version).toBe(1);
    expect(() => wo.claim({ ...builder, id: 'other' }, at + 1000)).toThrow();
    expect(() => wo.claim({ ...builder, builderId: 'other' }, at + 1000)).toThrow();
  });
  it('records operator roots for reputation without pretending they prove outside demand', () => {
    expect(order().claim(builder, at).outsideOperator).toBe(true);
    expect(order().claim({ ...builder, operatorRootId: 'buyer_root' }, at).outsideOperator).toBe(false);
  });
  it('rejects commands at lease expiry, then explicitly expires and reposts without reusing a claim', () => {
    const wo = order();
    wo.claim(builder, at);
    wo.build(builder.id, at + 1);
    expect(() => wo.build(builder.id, at + 2)).toThrow();
    const before = wo.snapshot;
    expect(() => wo.submit(builder.id, 'a'.repeat(40), 'pkg_1', at + LEASE_MS)).toThrow();
    expect(wo.snapshot).toEqual(before);
    expect(() => wo.expire(at + LEASE_MS - 1)).toThrow();
    wo.expire(at + LEASE_MS);
    expect(wo.snapshot.state).toBe('LEASE_EXPIRED');
    wo.repost(at + LEASE_MS + 1);
    expect(() => wo.claim(builder, at + LEASE_MS + 2)).toThrow();
    wo.claim({ ...builder, id: 'claim_2' }, at + LEASE_MS + 2);
    expect(wo.snapshot.claims.filter((c) => c.status === 'ACTIVE')).toHaveLength(1);
    wo.release('claim_2', at + LEASE_MS + 3);
    expect(wo.snapshot.claims.map((c) => c.status)).toEqual(['EXPIRED', 'RELEASED']);
  });
  it('submits the exact package/commit, then blocks automatic lease expiry while checking', () => {
    const wo = order();
    wo.claim(builder, at);
    wo.build(builder.id, at + 1);
    expect(() => wo.submit('foreign', 'a'.repeat(40), 'pkg_1', at + 2)).toThrow();
    expect(() => wo.submit(builder.id, 'bad', 'pkg_1', at + 2)).toThrow();
    expect(() => wo.submit(builder.id, 'a'.repeat(40), '', at + 2)).toThrow();
    wo.submit(builder.id, 'a'.repeat(40), 'pkg_1', at + 2);
    expect(() => wo.checking('other', at + 3)).toThrow();
    wo.checking('pkg_1', at + 3);
    expect(wo.snapshot.submission).toEqual({ commit: 'a'.repeat(40), packageId: 'pkg_1', claimId: builder.id });
    for (const action of [
      () => wo.expire(at + LEASE_MS),
      () => wo.release(builder.id, at + 4),
      () => wo.repost(at + LEASE_MS),
    ])
      expect(action).toThrow();
  });
  it('allows explicit clock-out and rejects bad identities, invalid or backwards clocks and stale state', () => {
    expect(() => new WorkOrder('', 'root', at)).toThrow();
    expect(() => new WorkOrder('wo', '', at)).toThrow();
    expect(() => new WorkOrder('wo', 'root', NaN)).toThrow();
    const wo = order();
    expect(() => wo.build('none', at)).toThrow();
    expect(() => wo.checking('none', at)).toThrow();
    for (const patch of [{ id: '' }, { builderId: '' }, { operatorId: '' }, { operatorRootId: '' }])
      expect(() => wo.claim({ ...builder, ...patch }, at)).toThrow();
    expect(() => wo.claim(builder, at - 1)).toThrow();
    expect(() => wo.claim(builder, NaN)).toThrow();
    wo.claim(builder, at);
    expect(() => wo.release('foreign', at + 1)).toThrow();
    wo.release(builder.id, at + 1);
    expect(wo.snapshot.state).toBe('ABANDONED');
    wo.repost(at + 2);
    expect(wo.snapshot.currentClaim).toBeNull();
    expect(wo.snapshot.claims[0]?.status).toBe('RELEASED');
  });
  it('never invents paid status, overlapping claims or mutations after rejected random commands', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 0, max: 6 }), fc.integer({ min: 0, max: LEASE_MS })), { maxLength: 100 }),
        (actions) => {
          const wo = order();
          let now = at;
          for (const [action, delta] of actions) {
            now += delta;
            const before = wo.snapshot;
            const id = before.currentClaim?.id ?? 'absent';
            try {
              switch (action) {
                case 0:
                  wo.claim({ ...builder, id: `claim_${before.version}` }, now);
                  break;
                case 1:
                  wo.build(id, now);
                  break;
                case 2:
                  wo.submit(id, 'a'.repeat(40), 'pkg_1', now);
                  break;
                case 3:
                  wo.checking('pkg_1', now);
                  break;
                case 4:
                  wo.expire(now);
                  break;
                case 5:
                  wo.repost(now);
                  break;
                case 6:
                  wo.release(id, now);
                  break;
              }
            } catch {
              expect(wo.snapshot).toEqual(before);
            }
            expect(wo.snapshot.claims.filter((c) => c.status === 'ACTIVE').length).toBeLessThanOrEqual(1);
            expect(wo.snapshot.state).not.toBe('PAID');
            expect(wo.snapshot.version).toBeGreaterThanOrEqual(before.version);
            for (const c of wo.snapshot.claims) expect(c.leasedUntil - c.claimedAt).toBe(LEASE_MS);
          }
        },
      ),
      { numRuns: 500 },
    );
  });
});
