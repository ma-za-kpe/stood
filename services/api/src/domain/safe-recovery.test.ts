import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RULE_SET_VERSION } from './decision.js';
import { advanceTrancheRecord, restoreTrancheRecord, type TrancheCommand } from './tranche-record.js';

const oldRecord = readFileSync(new URL('./fixtures/old-rule-held.json', import.meta.url), 'utf8');
const at = 1790985600000;
const expiry = at + 29 * 86400000;
const advance = (record: string, method: TrancheCommand['method'], args: unknown[] = []) =>
  advanceTrancheRecord(record, { method, args } as unknown as TrancheCommand);
const release = {
  outcome: 'RELEASE',
  effect: 'CAPTURE',
  profileId: 'construction.stage@1',
  ruleSetVersion: '1.0.0',
  namedField: null,
  reason: 'fixture',
  detail: null,
};
const oldPending = () => {
  const document = JSON.parse(oldRecord);
  document.commands.push(
    { method: 'startDeciding', args: [] },
    { method: 'beginSettlement', args: [release, 'old_decision', at] },
  );
  return JSON.stringify(document);
};
describe('Old-rule safe recovery', () => {
  it('restores an old hold, blocks active work and cancels without claiming expiry', () => {
    const tranche = restoreTrancheRecord(oldRecord);
    expect(tranche.safeRecovery).toBe(true);
    expect(tranche.canSubmitPendingOperation).toBe(false);
    for (const command of ['fundingFailed', 'startDeciding', 'redispatch', 'dispute'] as const)
      expect(() => advance(oldRecord, command)).toThrow('Safe recovery');
    expect(() => advance(oldRecord, 'dispatch', ['new', 'K7Q', at, expiry])).toThrow('Safe recovery');
    expect(() => advance(oldRecord, 'beginReauthorization', [at + 3 * 86400000])).toThrow('Safe recovery');
    expect(() => advance(oldRecord, 'cancel', [at - 1])).toThrow();
    let record = advance(oldRecord, 'cancel', [at]);
    expect(restoreTrancheRecord(record).canSubmitPendingOperation).toBe(true);
    record = advance(record, 'confirmSettlement', [
      { effect: 'VOID', authorizationId: 'auth_old', reference: 'void_fixture' },
    ]);
    expect(restoreTrancheRecord(record).state).toBe('CANCELLED');
    expect(JSON.parse(record).ruleSetVersion).toBe('1.0.0');
    expect(restoreTrancheRecord(advance(oldRecord, 'expire', [expiry])).pendingOperation?.target).toBe('EXPIRED');
  });
  it('retains a prior capture for reconciliation and never authorises another call', () => {
    const record = oldPending();
    const tranche = restoreTrancheRecord(record);
    expect(tranche.pendingOperation?.key).toBe('trn_old:1:CAPTURE:1');
    expect(tranche.canSubmitPendingOperation).toBe(false);
    expect(tranche.decisions[0]?.decision.ruleSetVersion).toBe('1.0.0');
    expect(() => advance(record, 'beginSettlement', [release, 'new', at])).toThrow('Safe recovery');
    expect(() => advance(record, 'cancel', [at])).toThrow();
    const confirmed = advance(record, 'confirmSettlement', [
      { effect: 'CAPTURE', authorizationId: 'auth_old', reference: 'already_captured' },
    ]);
    expect(restoreTrancheRecord(confirmed).state).toBe('RELEASED');
    const declined = advance(record, 'settlementFailed', [
      { effect: 'CAPTURE', authorizationId: 'auth_old', kind: 'DECLINED' },
    ]);
    expect(restoreTrancheRecord(advance(declined, 'cancel', [at])).pendingOperation?.effect).toBe('VOID');
  });
  it('keeps current records normal and rejects malformed or future versions', () => {
    const document = JSON.parse(oldRecord);
    document.ruleSetVersion = RULE_SET_VERSION;
    const current = restoreTrancheRecord(JSON.stringify(document));
    expect(current.safeRecovery).toBe(false);
    expect(() => current.cancel(at)).toThrow();
    for (const version of [null, 'future', '01.0.0', '9.0.0', '1.9.0', '1.1.9', '9007199254740992.0.0'])
      expect(() => restoreTrancheRecord(JSON.stringify({ ...document, ruleSetVersion: version }))).toThrow();
  });
});
