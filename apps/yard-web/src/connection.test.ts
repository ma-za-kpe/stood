import { expect, it } from 'vitest';
import { createActor } from 'xstate';
import { connectionMachine, staleConnection } from './connection.js';

it('recovers a dropped stream and reloads gaps without claiming connected', () => {
  const actor = createActor(connectionMachine).start();
  expect(actor.getSnapshot().value).toBe('disconnected');
  actor.send({ type: 'CONNECT' });
  expect(actor.getSnapshot().value).toBe('connecting');
  actor.send({ type: 'OPEN' });
  expect(actor.getSnapshot().value).toBe('live');
  actor.send({ type: 'ERROR' });
  expect(actor.getSnapshot().value).toBe('disconnected');
  actor.send({ type: 'CONNECT' });
  actor.send({ type: 'OPEN' });
  expect(actor.getSnapshot().value).toBe('live');
  actor.send({ type: 'GAP' });
  expect(actor.getSnapshot().value).toBe('reloading');
  actor.send({ type: 'ERROR' });
  expect(actor.getSnapshot().value).toBe('disconnected');
  actor.stop();
});
it('detects stale transport with monotonic elapsed time, independently of payment time', () => {
  expect(staleConnection(100, 35100)).toBe(false);
  expect(staleConnection(100, 35101)).toBe(true);
  expect(staleConnection(100, 100)).toBe(false);
});
