import { createMachine } from 'xstate';
export const connectionMachine = createMachine({
  id: 'connection',
  initial: 'disconnected',
  states: {
    disconnected: { on: { CONNECT: 'connecting' } },
    connecting: { on: { OPEN: 'live', ERROR: 'disconnected' } },
    live: { on: { ERROR: 'disconnected', GAP: 'reloading' } },
    reloading: { on: { OPEN: 'live', ERROR: 'disconnected' } },
  },
});

export const staleConnection = (lastReceived: number, now: number): boolean => now - lastReceived > 35_000;
