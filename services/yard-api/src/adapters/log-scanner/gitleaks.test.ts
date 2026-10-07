import { expect, it } from 'vitest';
import { GitleaksScanner } from './gitleaks.js';

it('uses the pinned default rules through stdin and ignores bypass annotations', async () => {
  const scanner = new GitleaksScanner();
  await scanner.ready();
  expect(await scanner.safe('Building booking routes. 12 of 14 tests pass.')).toBe(true);
  const synthetic = ['ghp', 'A9c7D2e5F8g1H4j6K3m9N2p5Q8r1S4t6V3w7'].join('_');
  expect(await scanner.safe(`access_token = "${synthetic}" # gitleaks:allow`)).toBe(false);
  expect(await scanner.safe(`token = "${synthetic}"`)).toBe(false);
  await expect(scanner.safe('')).rejects.toThrow('INVALID_LOG');
  await expect(scanner.safe('a'.repeat(16385))).rejects.toThrow('INVALID_LOG');
});
