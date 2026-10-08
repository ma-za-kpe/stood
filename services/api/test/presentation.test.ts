import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('states live sandbox status and discloses illustrative outcomes before users encounter a sample decision', () => {
  const html = readFileSync(new URL('../../../site/index.html', import.meta.url), 'utf8');
  const hero = html.slice(html.indexOf('<section class="hero"'), html.indexOf('<!-- TICKER -->'));
  const notice = hero.indexOf('id="simulation-notice"');
  expect(notice).toBeGreaterThan(-1);
  expect(notice).toBeLessThan(hero.indexOf('<figure'));
  expect(hero.slice(notice, hero.indexOf('</p>', notice))).toMatch(
    /examples.*(?:execute no payment|No payment is executed)/i,
  );
  expect(hero.slice(notice, hero.indexOf('</p>', notice))).toContain('Live PayPal sandbox');
  const readme = readFileSync(new URL('../../../README.md', import.meta.url), 'utf8');
  const intro = readme.slice(0, readme.indexOf('## The problem'));
  expect(intro).toContain('**Live PayPal sandbox. No real money.**');
  expect(intro).toContain('Foreman');
  expect(intro).not.toMatch(/Status: early implementation|Mock preview/);
});
