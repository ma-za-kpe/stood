import { describe, expect, it } from 'vitest';
import { FaultController, replayEvents } from './faults.js';

describe('Deterministic simulator fault plans', () => {
  it('matches exact routes, consumes once and exposes no public control endpoints', () => {
    const faults = new FaultController([
      { method: 'POST', path: '/v2/payments/authorizations/fixture/capture', kind: 'LOST_RESPONSE' },
    ]);
    expect(faults.take('GET', '/v2/payments/authorizations/fixture/capture')).toBeNull();
    expect(faults.take('POST', '/v2/payments/authorizations/other/capture')).toBeNull();
    expect(faults.take('POST', '/v2/payments/authorizations/fixture/capture')).toMatchObject({ kind: 'LOST_RESPONSE' });
    expect(faults.take('POST', '/v2/payments/authorizations/fixture/capture')).toBeNull();
    expect(() => new FaultController([{ method: 'POST', path: '/health', kind: 'LOST_RESPONSE' }])).toThrow();
  });
  it('releases stalled responses explicitly without wall-clock sleeps', async () => {
    const faults = new FaultController([]);
    let finished = false;
    const pending = faults.wait().then(() => {
      finished = true;
    });
    await Promise.resolve();
    expect(finished).toBe(false);
    faults.release();
    await pending;
    expect(finished).toBe(true);
  });
  it('replays duplicated and out-of-order events without altering stored history', () => {
    const source = [
      { id: '1', resource: { status: 'CREATED' } },
      { id: '2', resource: { status: 'CAPTURED' } },
    ];
    const replayed = replayEvents(source, [1, 0, 1]);
    expect(replayed.map((e) => e.id)).toEqual(['2', '1', '2']);
    if (!replayed[0]) throw new Error('Missing replay');
    replayed[0].resource.status = 'wrong';
    expect(source[1]?.resource.status).toBe('CAPTURED');
    expect(() => replayEvents(source, [2])).toThrow();
  });
});
