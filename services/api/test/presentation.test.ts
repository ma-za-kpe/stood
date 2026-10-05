import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('labels synthetic outcomes before users encounter the landing-page decision or README quickstart', () => {
  const html = readFileSync(new URL('../../../site/index.html', import.meta.url), 'utf8');
  const hero = html.slice(html.indexOf('<section class="hero"'), html.indexOf('<!-- TICKER -->'));
  const notice = hero.indexOf('id="simulation-notice"');
  expect(notice).toBeGreaterThan(-1);
  expect(notice).toBeLessThan(hero.indexOf('<figure'));
  expect(hero.slice(notice, hero.indexOf('</p>', notice))).toContain('No payment is executed');
  expect(hero.slice(notice, hero.indexOf('</p>', notice))).toContain('synthetic evidence');
  const readme = readFileSync(new URL('../../../README.md', import.meta.url), 'utf8');
  const intro = readme.slice(0, readme.indexOf('## The problem'));
  expect(intro).toContain('**Simulated demos. No payment is executed.**');
  expect(intro).toContain('Keys alone do not qualify an adapter');
});
