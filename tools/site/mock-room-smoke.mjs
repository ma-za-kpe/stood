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
    await page.getByRole('button', { name: 'Show site log', exact: true }).click();
    await page.getByText('Simulated build started.', { exact: true }).waitFor();
    await page.getByText('Simulated commit submitted for checking.', { exact: true }).waitFor();
    const logRegion = page.getByRole('region', { name: 'Build updates', exact: true });
    assert.equal(await logRegion.locator('[aria-live]').count(), 0, 'build lines are not live announcements');
    assert.equal(await logRegion.locator('li').count(), 2);
    await page.getByRole('button', { name: 'Pause scrolling', exact: true }).click();
    assert.equal(
      await page.getByRole('button', { name: 'Follow latest', exact: true }).getAttribute('aria-pressed'),
      'true',
    );
    await page.getByRole('button', { name: 'Follow latest', exact: true }).click();

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
      // Handover stays blocked while a milestone is unpaid; Yard's own items are shown as done.
      await page.getByRole('heading', { name: 'Your turn. Take the keys.', exact: true }).waitFor();
      assert(await page.getByRole('button', { name: 'Close the project', exact: true }).isDisabled());
      await page.getByText('Every milestone must be paid by Stood', { exact: false }).waitFor();
      // Step 9: a test key is stored write-only; a live key is refused.
      const keys = page.getByRole('region', { name: 'Test keys', exact: true });
      await keys.getByLabel('Name', { exact: true }).fill('SUPABASE_URL');
      await keys.getByLabel('Value', { exact: true }).fill('https://synthetic-dev-project.supabase.co');
      await keys.getByRole('button', { name: 'Store test key', exact: true }).click();
      await keys.getByText('Stored encrypted.', { exact: false }).waitFor();
      await keys.getByRole('list', { name: 'Stored test keys' }).getByText('SUPABASE_URL').waitFor();
      assert.equal(await keys.getByLabel('Value', { exact: true }).inputValue(), '');
      assert(!(await page.content()).includes('synthetic-dev-project'), 'a stored value never reaches the page');
      await keys.getByLabel('Name', { exact: true }).fill('STRIPE_KEY');
      await keys.getByLabel('Provider', { exact: true }).selectOption('stripe');
      await keys.getByLabel('Value', { exact: true }).fill(`sk_live_${'a'.repeat(24)}`);
      await keys.getByRole('button', { name: 'Store test key', exact: true }).click();
      await keys.getByText('Refused. Only test or dev keys', { exact: false }).waitFor();
      await accessible(page, 'keys and handover panels');
      // A refused-then-reworked milestone keeps its refusal history after payment.
      await page.getByRole('textbox', { name: 'Project ID', exact: true }).fill('yard-rework-project');
      await page.getByRole('button', { name: 'Open project →', exact: true }).click();
      await page.getByText('Paid on attempt 2, after 1 Stood refusal.', { exact: true }).waitFor();
      await accessible(page, 'reworked and paid room');
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
      await page.getByText('Due ', { exact: false }).first().waitFor();
      // Keyboard: End moves focus to the last card's action.
      await page.getByRole('button', { name: 'Clock in →', exact: true }).first().focus();
      await page.keyboard.press('End');
      assert(await page.evaluate(() => document.activeElement?.textContent?.includes('Clock in')));
      await page.getByRole('button', { name: 'Clock in →', exact: true }).click();
      await page.getByRole('heading', { name: 'Lease lifecycle simulation', exact: true }).waitFor();
      await page.getByText('left on the lease', { exact: false }).waitFor();
      await page.getByText('Signed tests (read-only):', { exact: false }).first().waitFor();
      await page.locator('.state-chip').filter({ hasText: 'CLAIMED' }).waitFor();
      assert.equal(await page.getByAltText('Stood / Released').count(), 0);
      assert.equal(await page.locator('.stood-verdict').count(), 0);
      let logReads = 0;
      page.on('request', (request) => {
        if (
          request.method() === 'GET' &&
          new URL(request.url()).pathname === '/app/api/blueprints/yard-lease/work-orders/build/log'
        )
          logReads++;
      });
      await page.getByRole('button', { name: 'Show site log', exact: true }).click();
      await page.getByText('No retained build updates yet.', { exact: true }).waitFor();
      const liveLog = page.getByRole('region', { name: 'Build updates', exact: true });
      await liveLog.focus();
      assert.equal(
        await page.evaluate(async () => {
          const response = await fetch('/app/api/blueprints/yard-lease/work-orders/build/log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'browser-live-log' },
            body: JSON.stringify({ lines: [{ kind: 'note', message: 'Builder update arrived over the stream.' }] }),
          });
          return response.status;
        }),
        201,
      );
      await page.getByText('Builder update arrived over the stream.', { exact: true }).waitFor();
      assert.equal(logReads, 1, 'a consecutive log event updates the cache without a snapshot reload');
      assert(
        await liveLog.evaluate((element) => element === document.activeElement),
        'live updates preserve keyboard focus',
      );
      assert.equal(await page.locator('.state-chip').innerText(), 'CLAIMED', 'progress cannot change money state');
      assert.equal(await page.locator('.stood-verdict').count(), 0);
      await accessible(page, 'live builder log accessibility');
    } else {
      await page.screenshot({ path: 'artifacts/mock-network/yard-board-mobile.png', fullPage: true });
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
  const nested = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const nestedPage = await nested.newPage();
  await nestedPage.goto('http://web:3002/__pages/yard/app?project=yard-project');
  assert.equal(new URL(nestedPage.url()).pathname, '/__pages/yard/app/');
  assert.equal(new URL(nestedPage.url()).search, '?project=yard-project');
  await nestedPage.getByAltText('Yard', { exact: true }).waitFor();
  assert(await nestedPage.getByAltText('Yard', { exact: true }).evaluate((img) => img.naturalWidth > 0));
  await nestedPage.getByRole('link', { name: 'Yard story', exact: true }).click();
  assert.equal(new URL(nestedPage.url()).pathname, '/__pages/yard/');
  await nested.close();
  const intakeContext = await browser.newContext({ viewport: { width: 1100, height: 900 }, reducedMotion: 'reduce' });
  const intakePage = await intakeContext.newPage();
  await intakePage.goto('http://web:3002/yard/app');
  assert.equal(new URL(intakePage.url()).pathname, '/yard/app/');
  await intakePage.getByRole('button', { name: 'Buyer', exact: true }).click();
  await intakePage.getByRole('button', { name: 'Describe a project', exact: true }).click();
  await intakePage.getByRole('button', { name: 'Start a private intake', exact: true }).click();
  await intakePage.getByRole('heading', { name: '1. The idea', exact: true }).waitFor();
  const intakeId = new URL(intakePage.url()).searchParams.get('intake');
  assert(intakeId);
  let writes = 0;
  intakePage.on('request', (r) => {
    if (r.method() === 'PUT' && r.url().includes('/intakes/')) writes++;
  });
  await intakePage.getByLabel('What are we building?', { exact: true }).fill('client_secret = synthetic-secret-value');
  await intakePage.getByRole('alert').filter({ hasText: 'That looks like a key' }).waitFor();
  assert.equal(writes, 0, 'recognised credentials never reach autosave');
  const retryHeaders = [];
  await intakePage.route(`**/app/api/intakes/${intakeId}`, async (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    retryHeaders.push({
      key: route.request().headers()['idempotency-key'],
      version: route.request().headers()['if-match'],
      body: route.request().postData(),
    });
    if (retryHeaders.length === 1) {
      await route.fetch();
      return route.abort('failed');
    }
    return route.continue();
  });
  const lostReply = intakePage.waitForEvent(
    'requestfailed',
    (r) => r.method() === 'PUT' && r.url().includes(`/intakes/${intakeId}`),
  );
  await intakePage.getByLabel('What are we building?', { exact: true }).fill('Build a booking app');
  await lostReply;
  await intakePage.getByRole('alert').filter({ hasText: 'Failed to fetch' }).waitFor();
  await intakePage.getByRole('button', { name: 'Save now', exact: true }).click();
  await intakePage.getByText('Saved privately.', { exact: true }).waitFor();
  assert.equal(retryHeaders.length, 2, 'lost autosave reply is retried once by the user');
  assert.deepEqual(retryHeaders[1], retryHeaders[0], 'autosave retry keeps the exact key, version and body');
  await intakePage.unroute(`**/app/api/intakes/${intakeId}`);
  for (let step = 0; step < 6; step++) {
    await intakePage.getByRole('button', { name: 'Let the Foreman decide', exact: true }).click();
    await intakePage.getByRole('button', { name: 'Next step', exact: true }).click();
  }
  await intakePage.getByLabel('Total builder budget', { exact: true }).fill('30.00');
  await intakePage.getByLabel('Budget currency', { exact: true }).selectOption('USD');
  await intakePage
    .getByLabel('Target deadline (UTC)', { exact: true })
    .fill(new Date(at + 21 * 86400000).toISOString().slice(0, 16));
  await intakePage.getByLabel('Who signs off at handover?', { exact: true }).fill('Demo buyer');
  await intakePage.getByLabel('Sign-off email', { exact: true }).fill('buyer@example.invalid');
  await intakePage.getByRole('button', { name: 'Let the Foreman decide', exact: true }).click();
  await intakePage.getByRole('button', { name: 'Next step', exact: true }).click();
  await intakePage.getByLabel('Your GitHub repository', { exact: true }).fill('buyer/project');
  await intakePage.getByRole('button', { name: 'Let the Foreman decide', exact: true }).click();
  await intakePage
    .getByLabel('Allow assigned agents or human builders to build this', { exact: true })
    .selectOption('true');
  await intakePage.getByRole('button', { name: 'Review my choices', exact: true }).click();
  await intakePage.getByRole('heading', { name: 'Read your choices.', exact: true }).waitFor();
  await accessible(intakePage, 'intake summary accessibility');
  await intakePage.getByRole('button', { name: 'Ask the Foreman for a blueprint', exact: true }).click();
  await intakePage.getByRole('heading', { name: 'Blueprint’s ready. Read the tests.', exact: true }).waitFor();
  assert(await intakePage.getByText('SIMULATED PLANNER', { exact: true }).isVisible());
  await intakePage.getByRole('button', { name: 'Edit blueprint', exact: true }).click();
  await intakePage.getByLabel('Project summary', { exact: true }).fill('Booking with reminders');
  await accessible(intakePage, 'unsigned blueprint editor');
  await intakePage.setViewportSize({ width: 390, height: 844 });
  assert(
    await intakePage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    'blueprint editor mobile overflow',
  );
  await accessible(intakePage, 'unsigned blueprint editor mobile');
  await intakePage.screenshot({ path: 'artifacts/mock-network/blueprint-editor-mobile.png', fullPage: true });
  await intakePage.setViewportSize({ width: 1280, height: 900 });
  const editRequests = [];
  await intakePage.route('**/app/api/plans/*/edits', async (route) => {
    editRequests.push({ key: route.request().headers()['idempotency-key'], body: route.request().postData() });
    const response = await route.fetch();
    assert.equal(response.status(), 200);
    if (editRequests.length === 1) await route.abort('failed');
    else await route.fulfill({ response });
  });
  await intakePage.getByRole('button', { name: 'Save draft for fresh review', exact: true }).click();
  await intakePage.getByRole('alert').filter({ hasText: 'The save is unresolved' }).waitFor();
  assert(
    await intakePage.getByLabel('Project summary', { exact: true }).isDisabled(),
    'unresolved edit must retain its exact body',
  );
  await intakePage.getByRole('button', { name: 'Retry same edit', exact: true }).click();
  await intakePage.getByRole('button', { name: 'Edit blueprint', exact: true }).waitFor();
  await intakePage.getByText('Booking with reminders', { exact: true }).waitFor();
  await intakePage.waitForFunction(() => document.activeElement?.textContent?.trim() === 'Edit blueprint');
  assert.equal(
    await intakePage.evaluate(() => document.activeElement?.textContent?.trim()),
    'Edit blueprint',
    'saving restores review focus',
  );
  await intakePage.getByText('Review version 2 · unsigned blueprint.', { exact: true }).waitFor();
  assert.equal(editRequests.length, 2);
  assert.deepEqual(editRequests[0], editRequests[1], 'lost edit reply keeps the exact request key and body');
  await intakePage.unroute('**/app/api/plans/*/edits');
  await intakePage.getByRole('button', { name: 'Request a revision', exact: true }).click();
  await intakePage.getByLabel('What should change?', { exact: true }).fill('Add a booking reminder');
  await intakePage.getByRole('button', { name: 'Revise the blueprint', exact: true }).click();
  await intakePage.getByText('Build a booking app — revised scope', { exact: true }).waitFor();
  await intakePage.getByRole('button', { name: 'Accept draft for baseline checks', exact: true }).click();
  await intakePage.getByText('Draft accepted. Baseline checks are required before signing.', { exact: true }).waitFor();
  await accessible(intakePage, 'intake plan accessibility');
  await intakePage.setViewportSize({ width: 390, height: 844 });
  assert(
    await intakePage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    'intake mobile overflow',
  );
  await intakePage.screenshot({ path: 'artifacts/mock-network/intake-plan-mobile.png', fullPage: true });
  await accessible(intakePage, 'intake mobile accessibility');
  await intakePage.reload();
  await intakePage.getByRole('button', { name: 'Buyer', exact: true }).click();
  await intakePage.getByRole('button', { name: 'Resume saved intake', exact: true }).click();
  await intakePage.getByRole('heading', { name: '8. Ownership and handover', exact: true }).waitFor();
  assert.equal(await intakePage.getByLabel('Your GitHub repository', { exact: true }).inputValue(), 'buyer/project');
  assert.equal(
    await intakePage.evaluate(async (id) => {
      const record = await (await fetch(`/app/api/intakes/${id}`)).json();
      return (
        await fetch(`/app/api/intakes/${id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'If-Match': String(record.version),
            'Idempotency-Key': 'other-tab',
          },
          body: JSON.stringify({
            step: 0,
            draft: { ...record.draft, idea: { ...record.draft.idea, description: 'Other tab changed the scope' } },
          }),
        })
      ).status;
    }, intakeId),
    200,
  );
  await intakePage.getByRole('alert').filter({ hasText: 'These answers changed in another tab' }).waitFor();
  await intakePage.getByRole('button', { name: 'Reload saved version', exact: true }).click();
  await intakePage.getByRole('heading', { name: '1. The idea', exact: true }).waitFor();
  assert.equal(
    await intakePage.getByLabel('What are we building?', { exact: true }).inputValue(),
    'Other tab changed the scope',
  );
  await intakePage.getByRole('button', { name: 'Builder', exact: true }).click();
  await intakePage
    .getByText('Choose the simulated buyer to start or resume a private intake.', { exact: true })
    .waitFor();
  assert.equal(
    await intakePage.getByLabel('Your GitHub repository', { exact: true }).count(),
    0,
    'builder cannot retain buyer intake',
  );
  await intakeContext.close();
  console.log(
    'Connected mock room: operator cancellation/isolation, desktop/mobile proof, SSE, simulation, theme, intake autosave/revision/recovery and overflow checks passed.',
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
