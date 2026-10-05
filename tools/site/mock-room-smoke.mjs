import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

mkdirSync('artifacts/mock-network', { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const [name, width, height] of [
    ['desktop', 1440, 1000],
    ['mobile', 390, 844],
  ]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
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
    await page.close();
  }
  console.log('Connected mock room: desktop/mobile proof, SSE, simulation, theme and overflow checks passed.');
} finally {
  await browser.close();
}
