import { z } from 'zod';

const schema = z.object({ mode: z.enum(['mock', 'hosted']), role: z.enum(['buyer', 'builder']).nullable() }).strict();
export type Session = z.infer<typeof schema>;
export const sessionChecked = (value: unknown): Session => schema.parse(value);

// What the page says about itself. 'mock' is the local Docker network; 'hosted' is Yard on Render.
export function notice(mode: Session['mode'] | 'unreachable' | 'loading'): Readonly<{ signal: string; text: string }> {
  if (mode === 'loading') return { signal: 'CONNECTING', text: 'Connecting to Yard to read its current status.' };
  if (mode === 'unreachable')
    return {
      signal: 'PREVIEW',
      text: 'This copy of the page cannot reach Yard. Use the hosted Yard at https://stood-yard-api.onrender.com/app/ to sign in.',
    };
  return mode === 'hosted'
    ? {
        signal: 'LIVE',
        text: 'Hosted Yard: the Board, events and site log are live. Stood is connected to the PayPal sandbox; Yard’s payment connection is still being built, so no real money moves.',
      }
    : {
        signal: 'SIMULATED',
        text: 'Local run: simulated providers and synthetic evidence. No payment is executed.',
      };
}
