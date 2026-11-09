import { describe, expect, it } from 'vitest';
import {
  agStudioLicenseChecked,
  agStudioLicenseState,
  reviewerLedgerChecked,
  reviewerSources,
  timelineTasks,
} from './c5-integrations.js';
import type { ProjectRoom } from './project-state.js';

const room: ProjectRoom = {
  id: 'project-1',
  version: 5,
  clock: Date.parse('2026-10-15T00:00:00Z'),
  summary: 'Private project summary',
  currency: 'USD',
  simulated: true,
  milestoneCount: 2,
  orders: [
    {
      id: 'wo-1',
      name: 'First milestone',
      state: 'PAID',
      budgetMinor: 1200,
      trancheId: 'tranche-1',
      deadline: Date.parse('2026-10-20T00:00:00Z'),
      payment: {
        trancheId: 'tranche-1',
        packageId: 'package-1',
        reference: 'capture-1',
        effect: 'CAPTURE',
        minor: 1200,
        currency: 'USD',
        simulated: true,
      },
      submission: null,
      leasedUntil: null,
    },
    {
      id: 'wo-2',
      name: 'Final milestone',
      state: 'CHECKING',
      budgetMinor: 1800,
      trancheId: 'tranche-2',
      deadline: Date.parse('2026-10-25T00:00:00Z'),
      payment: null,
      submission: null,
      leasedUntil: null,
      final: true,
      usage: null,
    },
  ],
};

describe('C5 integrations', () => {
  it('uses a plain-table fallback when the license is absent or expired and warns before expiry', () => {
    const expires = '2026-11-24T00:00:00.000Z';
    expect(agStudioLicenseState('', expires, Date.parse('2026-10-15T00:00:00Z'))).toBe('missing');
    expect(agStudioLicenseState('trial', expires, Date.parse('2026-11-10T00:00:00Z'))).toBe('expiring');
    expect(agStudioLicenseState('trial', expires, Date.parse('2026-11-24T00:00:00Z'))).toBe('expired');
    expect(agStudioLicenseState('trial', expires, Date.parse('2026-11-01T00:00:00Z'))).toBe('licensed');
    expect(agStudioLicenseState('trial', 'not-a-date', 0)).toBe('invalid');
  });

  it('validates the runtime license response and refuses a key on expired responses', () => {
    expect(agStudioLicenseChecked({ state: 'missing' })).toEqual({ state: 'missing' });
    expect(() => agStudioLicenseChecked(null)).toThrow('Invalid AG Studio license response');
    expect(() => agStudioLicenseChecked([])).toThrow('Invalid AG Studio license response');
    expect(() => agStudioLicenseChecked({ state: 'unknown' })).toThrow('Invalid AG Studio license state');
    expect(() => agStudioLicenseChecked({ state: 'missing', expiresAt: 'not-a-date' })).toThrow(
      'Invalid AG Studio expiry',
    );
    expect(() => agStudioLicenseChecked({ state: 'expired', licenseKey: 'should-not-be-returned' })).toThrow(
      'Inactive AG Studio license must not expose its key',
    );
    expect(() => agStudioLicenseChecked({ state: 'licensed', licenseKey: 'active', expiresAt: 'not-a-date' })).toThrow(
      'Invalid AG Studio expiry',
    );
    expect(() => agStudioLicenseChecked({ state: 'licensed', licenseKey: 'active' })).toThrow(
      'An active AG Studio license must have a key and expiry',
    );
  });

  it('builds two separate read-only dashboard sources with capture proof matched to expected amount', () => {
    const ledger = reviewerLedgerChecked(
      {
        simulated: true,
        lines: [
          { wo: 'wo-1', currency: 'USD', builderMinor: 1200, capturedMinor: 1200, state: 'HELD_BACK', simulated: true },
          { wo: 'wo-2', currency: 'USD', builderMinor: 1800, capturedMinor: 0, state: 'AUTHORIZED', simulated: true },
        ],
      },
      room,
    );
    const sources = reviewerSources(room, ledger);
    expect(sources.map((source) => source.id)).toEqual(['milestones', 'reconciliation']);
    expect(sources[0]?.data).toEqual([
      { milestone: 'First milestone', state: 'PAID', amount: 12, due: '2026-10-20T00:00:00.000Z' },
      { milestone: 'Final milestone', state: 'CHECKING', amount: 18, due: '2026-10-25T00:00:00.000Z' },
    ]);
    expect(sources[1]?.data).toEqual([
      {
        milestone: 'First milestone',
        state: 'MATCHED',
        expected: 12,
        captured: 12,
        ledgerState: 'HELD_BACK',
        reference: 'capture-1',
      },
      {
        milestone: 'Final milestone',
        state: 'NOT_CAPTURED',
        expected: 18,
        captured: 0,
        ledgerState: 'AUTHORIZED',
        reference: '',
      },
    ]);
    expect(JSON.stringify(sources)).not.toContain('Private project summary');
  });

  it('refuses a ledger that does not match the project instead of presenting a false reconciliation', () => {
    expect(() => reviewerLedgerChecked(null, room)).toThrow('Invalid ledger response');
    expect(() => reviewerLedgerChecked([], room)).toThrow('Invalid ledger response');
    expect(() => reviewerLedgerChecked({ simulated: true, lines: [] }, room)).toThrow('Invalid ledger response');
    expect(() => reviewerLedgerChecked({ simulated: true, lines: [null, null] }, room)).toThrow('Invalid ledger line');
    expect(() =>
      reviewerLedgerChecked(
        {
          simulated: true,
          lines: [
            {
              wo: 'wo-1',
              currency: 'USD',
              builderMinor: 1200,
              capturedMinor: 1200,
              state: 'HELD_BACK',
              simulated: true,
            },
            { wo: 'wo-2', currency: 'EUR', builderMinor: 1800, capturedMinor: 0, state: 'AUTHORIZED', simulated: true },
          ],
        },
        room,
      ),
    ).toThrow('Ledger does not match this project room');
  });

  it('reports unmatched or absent proofs as mismatch or not captured and never invents a reference', () => {
    const mismatch = reviewerSources(room, [
      { wo: 'wo-1', currency: 'USD', builderMinor: 1200, capturedMinor: 700, state: 'CAPTURED', simulated: true },
      { wo: 'wo-2', currency: 'USD', builderMinor: 1800, capturedMinor: 300, state: 'CAPTURED', simulated: true },
    ]);
    expect(mismatch[1]?.data).toEqual([
      {
        milestone: 'First milestone',
        state: 'MISMATCH',
        expected: 12,
        captured: 7,
        ledgerState: 'CAPTURED',
        reference: '',
      },
      {
        milestone: 'Final milestone',
        state: 'MISMATCH',
        expected: 18,
        captured: 3,
        ledgerState: 'CAPTURED',
        reference: '',
      },
    ]);
    const absent = reviewerSources(room, []);
    expect(absent[1]?.data[0]).toMatchObject({ state: 'MISMATCH', captured: 0, ledgerState: 'UNKNOWN' });
    expect(absent[1]?.data[1]).toMatchObject({ state: 'NOT_CAPTURED', captured: 0, ledgerState: 'UNKNOWN' });

    const noReference = {
      ...room,
      orders: room.orders.map((order) =>
        order.id === 'wo-1' && order.payment
          ? { ...order, payment: { ...order.payment, reference: undefined } }
          : order,
      ),
    } as unknown as ProjectRoom;
    const matchedWithoutReference = reviewerSources(noReference, [
      { wo: 'wo-1', currency: 'USD', builderMinor: 1200, capturedMinor: 1200, state: 'CAPTURED', simulated: true },
      { wo: 'wo-2', currency: 'USD', builderMinor: 1800, capturedMinor: 0, state: 'AUTHORIZED', simulated: true },
    ]);
    expect(matchedWithoutReference[1]?.data[0]).toMatchObject({ state: 'MATCHED', reference: '' });
  });

  it('derives read-only Gantt tasks and unlocks only when the order state is PAID', () => {
    const tasks = timelineTasks(room);
    expect(tasks).toEqual([
      {
        id: 'wo-1',
        name: 'First milestone · released',
        startDate: room.orders[0]?.deadline,
        duration: 0,
        milestone: true,
        manuallyScheduled: true,
        readOnly: true,
        locked: false,
      },
      {
        id: 'wo-2',
        name: 'Final milestone · locked',
        startDate: room.orders[1]?.deadline,
        duration: 0,
        milestone: true,
        manuallyScheduled: true,
        readOnly: true,
        locked: true,
      },
    ]);
  });
});
