import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { AxeBuilder } from '@axe-core/playwright';
import { chromium } from 'playwright';

// Synthetic operator codes only. The production image runs against an isolated disposable Postgres database.
const code = 'hosted-test-buyer-code-0123456789abcdef';
const builder = 'hosted-test-builder-code-0123456789abcdef';
const fixture = readFileSync('/fixture.json', 'utf8');
mkdirSync('/out', { recursive: true });
const browser = await chromium.launch();
async function accessible(page, label) {
  const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  assert.deepEqual(
    scan.violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) })),
    [],
    label,
  );
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    `${label}: no overflow`,
  );
}
try {
  for (const [name, viewport] of [
    ['desktop', { width: 1280, height: 900 }],
    ['mobile', { width: 390, height: 844 }],
  ]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => {
      window.cspViolations = [];
      document.addEventListener('securitypolicyviolation', (e) =>
        window.cspViolations.push({
          blocked: e.blockedURI,
          source: e.sourceFile,
          line: e.lineNumber,
          directive: e.effectiveDirective,
        }),
      );
    });
    page.on('console', (m) => {
      if (m.type() === 'error' && !/401/.test(m.text())) errors.push(m.text());
    });
    await page.goto('http://localhost:3001/app');
    assert.equal(new URL(page.url()).pathname, '/app/');
    await page.getByLabel('Access code').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Buyer', exact: true }).count(), 0);
    await accessible(page, `${name}: sign-in`);
    await page.getByLabel('Access code').fill(code);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByText('Signed in as the buyer.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'The Board', exact: true }).click();
    await page.getByRole('heading', { name: 'Pick work. Stand behind it.' }).waitFor();
    await page.getByRole('button', { name: 'Describe a project', exact: true }).click();
    await page.getByLabel('Startup Tribunal JSON').fill(fixture);
    await page.getByRole('button', { name: 'Review imported idea' }).click();
    await page.getByRole('heading', { name: 'What Yard understood' }).waitFor();
    assert.match(await page.locator('.tribunal-import').innerText(), /rejected/);
    await accessible(page, `${name}: research preview`);
    await page.screenshot({ path: `/out/yard-import-${name}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Use this idea in a private intake' }).click();
    await page.getByLabel('What are we building?').waitFor();
    assert.match(await page.getByLabel('What are we building?').inputValue(), /ShieldVC/);
    assert.equal(await page.getByLabel('Access code').count(), 0);
    const id = new URL(page.url()).searchParams.get('intake');
    assert(id);
    await page.reload();
    await page.getByText('Signed in as the buyer.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Resume saved intake' }).click();
    await page.getByLabel('What are we building?').waitFor();
    assert.match(await page.getByLabel('What are we building?').inputValue(), /Tribunal decision: rejected/);
    await accessible(page, `${name}: resumed intake`);
    await page.screenshot({ path: `/out/yard-intake-${name}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByLabel('Access code').waitFor();
    assert.equal(await page.getByText('Signed in as the buyer.', { exact: true }).count(), 0);
    await page.getByLabel('Access code').fill(builder);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByText('Signed in as the builder.', { exact: true }).waitFor();
    const denied = await page.evaluate(async (intake) => (await fetch(`/app/api/intakes/${intake}`)).status, id);
    assert.equal(denied, 403);
    assert.equal(await page.getByLabel('What are we building?').count(), 0);
    assert.deepEqual(await page.evaluate(() => window.cspViolations), [], 'no application CSP violations');
    // The denied request is expected; browser rendering/CSP errors are not.
    assert.deepEqual(
      errors.filter((s) => !/403/.test(s)),
      [],
    );
    console.log(
      `Hosted Yard ${name}: sign-in, Board, import, private persistence, reload, logout, operator isolation and axe passed`,
    );
    await context.close();
  }
} finally {
  await browser.close();
}
