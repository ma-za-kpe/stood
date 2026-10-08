import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { staticServer } from './serve.mjs';

assert.equal(process.versions.node.split('.')[0], '24');
const server = staticServer('_site');
await new Promise((done) => server.listen(4173, '127.0.0.1', done));
assert.equal((await fetch('http://127.0.0.1:4173/%2e%2e%2f.env')).status, 404);
mkdirSync('artifacts/site', { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const [name, width, height] of [
    ['desktop', 1440, 1000],
    ['mobile', 390, 844],
  ]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('response', (r) => {
      if (r.url().startsWith('http://127.0.0.1:4173') && r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
    });
    page.on('request', (r) => {
      if (r.method() !== 'GET') errors.push(`Unexpected mutation ${r.method()}`);
    });
    // T-0262: the hosted health checks are intercepted. Desktop sees them answer; mobile sees them fail.
    const live = name === 'desktop';
    await page.route('https://stood-api.onrender.com/health', (route) =>
      live
        ? route.fulfill({
            json: {
              paymentReady: false,
              providers: [{ provider: 'paypal', mode: 'live', simulated: false, ready: true }],
            },
          })
        : route.abort(),
    );
    await page.route('https://stood-yard-api.onrender.com/health', (route) =>
      live ? route.fulfill({ json: { capabilities: { board: true } } }) : route.abort(),
    );
    const status = live
      ? /^Live status: PayPal sandbox connected · payments off until qualified · Yard Board live\. PayPal sandbox only; no real money\.$/
      : /^Mock preview\. The hosted sandbox did not answer/;
    assert.equal((await page.goto('http://127.0.0.1:4173/yard/')).status(), 200);
    await page.waitForFunction(() => document.getElementById('system-status')?.dataset.state !== 'checking');
    assert.match(await page.locator('#system-status').innerText(), status);
    await page.getByRole('heading', { level: 1 }).waitFor();
    await page.keyboard.press('Tab');
    assert.equal(
      await page
        .getByRole('link', { name: 'Skip to content' })
        .evaluate((e) => e === document.activeElement && getComputedStyle(e).opacity === '1'),
      true,
    );
    assert.match(await page.locator('#simulation-notice').innerText(), /No payment is executed/);
    assert.match(await page.locator('#verdict-sentence').innerText(), /cannot mark this milestone paid/);
    const notice = await page.locator('#simulation-notice').boundingBox();
    const verdict = await page.locator('#fixture-verdict').boundingBox();
    assert(notice.y < verdict.y, 'Disclosure precedes sample money verdict');
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
      `${name}: no horizontal page overflow`,
    );
    assert.equal(await page.locator('.crane-load').evaluate((e) => getComputedStyle(e).animationName), 'none');
    await page.getByRole('radio', { name: '01 · Checking' }).focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.getByRole('radio', { name: '02 · Work stands' }).isChecked(), true);
    assert.match(await page.locator('#verdict-sentence').innerText(), /Simulated capture confirmed/);
    assert.match(await page.locator('#fixture-disclosure').innerText(), /no payment executed/);
    await page.getByText('03 · Tests changed', { exact: true }).click();
    assert.match(await page.locator('#verdict-sentence').innerText(), /Signed tests changed/);
    await page.getByText('01 · Checking', { exact: true }).click();
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: `artifacts/site/yard-${name}.png`, fullPage: true });
    await page.screenshot({ path: `artifacts/site/yard-${name}-hero.png` });
    await page.getByRole('link', { name: '← Back to Stood' }).click();
    await page.waitForURL('http://127.0.0.1:4173/');
    await page.waitForLoadState('load');
    await page.waitForFunction(() => document.getElementById('system-status')?.dataset.state !== 'checking');
    assert.match(await page.locator('#system-status').innerText(), status);
    const family = page.getByRole('link', {
      name: 'Yard builds. Stood pays. Explore the simulated Yard preview.',
      exact: true,
    });
    assert.equal(await family.count(), 1, 'Stood shows the linked family lockup');
    await family.scrollIntoViewIfNeeded();
    await page.waitForFunction(
      () => {
        const img = document.querySelector('img[src$="family-lockup-on-dark.svg"]');
        return img?.complete && img.naturalWidth > 0;
      },
      null,
      { timeout: 5000 },
    );
    await family.click();
    assert.equal(new URL(page.url()).pathname, '/yard/');
    await page.getByRole('link', { name: '← Back to Stood' }).click();
    await page.getByRole('link', { name: 'Yard →', exact: true }).click();
    assert.equal(new URL(page.url()).pathname, '/yard/');
    assert.deepEqual(errors, [], `${name}: browser errors or missing assets`);
    await page.close();
    console.log(`Yard ${name}: simulation notice, keyboard fixtures, navigation, reduced motion and assets passed`);
  }
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
