import { describe, expect, it } from 'vitest';
import { Nonce } from './nonce.js';

describe('Nonce (FR-11)', () => {
  it('normalises a valid code and matches case-insensitively', () => {
    const nonce = new Nonce('k7q');
    expect(nonce.value).toBe('K7Q');
    expect(nonce.matches('k7Q')).toBe(true);
    expect(nonce.matches(' K7 Q\n')).toBe(true);
    expect(nonce.matches('K7R')).toBe(false);
    expect(Object.isFrozen(nonce)).toBe(true);
  });
  it.each(['', 'K7', 'K7QQ', 'O7Q', 'I7Q', '01Q', ' K7Q', 'K7Q\n', '💰AB'])(
    'rejects ambiguous or malformed code %s',
    (code) => {
      expect(() => new Nonce(code)).toThrow();
    },
  );
});
