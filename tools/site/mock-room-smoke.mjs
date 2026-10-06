import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { AxeBuilder } from '@axe-core/playwright';
import { chromium } from 'playwright';

async function accessible(page, label) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  assert.deepEqual(
    result.violations.map((v) => ({ id: v.id, impact: v.impact, targets: v.nodes.map((n) => n.target) })),
    [],
    label,
  );
}

mkdirSync('artifacts/mock-network', { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const privacy = await browser.newContext({ viewport: { width: 1100, height: 850 }, reducedMotion: 'reduce' });
  const privatePage = await privacy.newPage();
  await privatePage.goto('http://web:3002/yard/app/');
  const [sessionResponse] = await Promise.all([
    privatePage.waitForResponse((response) => new URL(response.url()).pathname === '/app/api/demo/session'),
    privatePage.getByRole('button', { name: 'Buyer', exact: true }).click(),
  ]);
  assert.equal(sessionResponse.status(), 200);
  await sessionResponse.finished();
  const at = Number(
    (
      await (
        await fetch('http://paypal-sim:8080/__sim/time', {
          headers: { Authorization: 'Bearer sim-access-token' },
        })
      ).json()
    ).now,
  );
  const privateId = `privacy-${Date.now()}`;
  const blueprint = {
    id: privateId,
    buyerOperatorId: 'buyer',
    repository: 'buyer/private',
    baseCommit: 'a'.repeat(40),
    summary: 'Private buyer room',
    capMinor: 2000,
    currency: 'USD',
    milestones: ['build', 'handover'].map((id, i) => ({
      id,
      name: id,
      budgetMinor: 1000,
      deadline: at + 7 * 86400000,
      profileId: i ? 'code.final@1' : 'code.milestone@1',
      testBundleHash: 'b'.repeat(64),
      manifestHash: 'c'.repeat(64),
      testIds: ['works'],
    })),
  };
  assert.equal(
    await privatePage.evaluate(async (input) => {
      const response = await fetch('/app/api/blueprints', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': input.id,
        },
        body: JSON.stringify(input),
      });
      return response.status;
    }, blueprint),
    201,
  );
  let heldRequest,
    aborted = false,
    releaseOld;
  let captured;
  const ready = new Promise((resolve) => {
    captured = resolve;
  });
  const release = new Promise((resolve) => {
    releaseOld = resolve;
  });
  privatePage.on('requestfailed', (request) => {
    if (request === heldRequest) aborted = true;
  });
  await privatePage.route(`**/app/api/blueprints/${privateId}/room`, async (route) => {
    if (heldRequest) return route.continue();
    heldRequest = route.request();
    const response = await route.fetch();
    assert.equal(response.status(), 200);
    captured();
    await release;
    await route.fulfill({ response }).catch(() => {});
  });
  await privatePage.getByRole('textbox', { name: 'Project ID', exact: true }).fill(privateId);
  await privatePage.getByRole('button', { name: 'Open project →', exact: true }).click();
  await ready;
  await privatePage.getByRole('button', { name: 'Builder', exact: true }).click();
  await privatePage.getByRole('alert').filter({ hasText: 'does not have access' }).waitFor();
  releaseOld();
  await privatePage.waitForTimeout(200);
  assert(aborted, 'operator switch must abort the previous buyer HTTP request');
  assert.equal(
    await privatePage.getByRole('heading', { name: 'Private buyer room', exact: true }).count(),
    0,
    'a delayed buyer response must never populate the builder room',
  );
  await privacy.close();
  for (const [name, width, height] of [
    ['desktop', 1440, 1000],
    ['mobile', 390, 844],
  ]) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('http://web:3002/yard/app/?project=yard-project');
    await page.getByRole('button', { name: 'Buyer', exact: true }).click();
    await page.getByRole('heading', { name: 'A booking app', exact: true }).waitFor();
    await page.getByAltText('Stood / Released').waitFor();
    await page.getByText('Simulated capture confirmed.', { exact: false }).waitFor();
    assert(
      await page
        .getByRole('note')
        .innerText()
        .then((t) => t.includes('No real payment is executed')),
    );
    await page.getByRole('status').filter({ hasText: 'Connected' }).waitFor();
    await accessible(page, `${name} dark room`);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    assert(
      await page.evaluate(
        () =>
          document.querySelector('aside.simulation').getBoundingClientRect().top <
          document.querySelector('.stood-verdict').getBoundingClientRect().top,
      ),
    );
    await page.getByRole('button', { name: 'Paper theme', exact: true }).click();
    assert.equal(await page.locator('.app').getAttribute('data-theme'), 'paper');
    await accessible(page, `${name} paper room`);
    await page.screenshot({ path: `artifacts/mock-network/yard-room-${name}.png`, fullPage: true });
    if (name === 'desktop') {
      await page.getByRole('textbox', { name: 'Project ID', exact: true }).fill('yard-lease');
      await page.getByRole('button', { name: 'Open project →', exact: true }).click();
      await page.getByRole('heading', { name: 'Lease lifecycle simulation', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Builder', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'does not have access' }).waitFor();
      assert.equal(await page.getByRole('heading', { name: 'Lease lifecycle simulation', exact: true }).count(), 0);
      assert.equal(await page.getByAltText('Stood / Released').count(), 0);
    }
    await page.getByRole('button', { name: 'The Board', exact: true }).click();
    await page.getByRole('heading', { name: 'Pick work. Stand behind it.', exact: true }).waitFor();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await accessible(page, `${name} paper Board`);
    if (name === 'desktop') {
      await page.getByRole('heading', { name: 'build', exact: true }).waitFor();
      await page.screenshot({ path: 'artifacts/mock-network/yard-board-desktop.png', fullPage: true });
      await page.getByRole('button', { name: 'Clock in →', exact: true }).click();
      await page.getByRole('heading', { name: 'Lease lifecycle simulation', exact: true }).waitFor();
      await page.locator('.state-chip').filter({ hasText: 'CLAIMED' }).waitFor();
      assert.equal(await page.getByAltText('Stood / Released').count(), 0);
      assert.equal(await page.locator('.stood-verdict').count(), 0);
    } else {
      await page.screenshot({ path: 'artifacts/mock-network/yard-board-mobile.png', fullPage: true });
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
  const nested = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const nestedPage = await nested.newPage();
  await nestedPage.goto('http://web:3002/__pages/yard/app/');
  await nestedPage.getByAltText('Yard', { exact: true }).waitFor();
  assert(await nestedPage.getByAltText('Yard', { exact: true }).evaluate((img) => img.naturalWidth > 0));
  await nestedPage.getByRole('link', { name: 'Yard story', exact: true }).click();
  assert.equal(new URL(nestedPage.url()).pathname, '/__pages/yard/');
  await nested.close();
  console.log(
    'Connected mock room: operator cancellation/isolation, desktop/mobile proof, SSE, simulation, theme and overflow checks passed.',
  );
} catch (error) {
  for (const [index, context] of browser.contexts().entries()) {
    for (const [number, page] of context.pages().entries())
      await page
        .screenshot({ path: `artifacts/mock-network/failure-${index}-${number}.png`, fullPage: true })
        .catch(() => {});
  }
  throw error;
} finally {
  await browser.close();
}
