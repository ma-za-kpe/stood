import { describe, expect, it } from 'vitest';
import { notice, sessionChecked } from './session.js';

// T-0266: the page asks the server how people sign in, and says plainly what is live.
describe('Yard page session', () => {
  it('accepts only the two session shapes the server sends', () => {
    expect(sessionChecked({ mode: 'hosted', role: null })).toEqual({ mode: 'hosted', role: null });
    expect(sessionChecked({ mode: 'mock', role: 'builder' })).toEqual({ mode: 'mock', role: 'builder' });
    for (const bad of [{ mode: 'hosted' }, { mode: 'live', role: null }, { mode: 'hosted', role: 'admin' }, null])
      expect(() => sessionChecked(bad)).toThrow();
  });
  it('tells visitors what is live without overclaiming', () => {
    const hosted = notice('hosted');
    expect(hosted.signal).toBe('LIVE');
    expect(hosted.text).toMatch(/PayPal sandbox/);
    expect(hosted.text).toMatch(/no real money/i);
    expect(`${hosted.text}${notice('mock').text}`).not.toMatch(/\b(fake|mock|placeholder)\b/i);
    expect(notice('mock').signal).toBe('SIMULATED');
    expect(notice('unreachable').text).toContain('https://stood-yard-api.onrender.com/app/');
  });
});
