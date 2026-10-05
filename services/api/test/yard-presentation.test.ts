import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('puts Yard simulation disclosure before its sample verdict and connects the two product pages', () => {
  const html = readFileSync(new URL('../../../site/yard/index.html', import.meta.url), 'utf8');
  const notice = html.indexOf('id="simulation-notice"');
  expect(notice).toBeGreaterThan(-1);
  expect(notice).toBeLessThan(html.indexOf('id="fixture-verdict"'));
  expect(html).toContain('No payment is executed');
  expect(html).toContain('<fieldset');
  expect(html).toContain('id="fixture-disclosure"');
  expect(html).toContain('href="../"');
  const stood = readFileSync(new URL('../../../site/index.html', import.meta.url), 'utf8');
  expect(stood).toContain('href="yard/"');
  expect(html).toContain('yard-lockup-on-dark.svg');
});
