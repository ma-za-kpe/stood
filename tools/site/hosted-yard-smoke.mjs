import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { AxeBuilder } from '@axe-core/playwright';
import { chromium } from 'playwright';

// Synthetic operator codes only. The production image runs against an isolated disposable Postgres database.
const code = 'hosted-test-buyer-code-0123456789abcdef';
const builder = 'hosted-test-builder-code-0123456789abcdef';
const sourceFixture = JSON.parse(readFileSync('/fixture.json', 'utf8'));
const fixture = JSON.stringify({ ...sourceFixture, owner_user_id: null });
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
    if (process.env.YARD_UI_COVERAGE === '1') await page.coverage.startJSCoverage({ resetOnNavigation: false });
    const mapped = [];
    const capture = async () => {
      if (process.env.YARD_UI_COVERAGE !== '1') return;
      for (const entry of (await page.coverage.stopJSCoverage()).filter((e) => /\/app\/assets\/.*\.js$/.test(e.url))) {
        const map = await context.request.get(`${entry.url}.map`);
        assert.equal(map.status(), 200, 'instrumented image must provide source maps');
        mapped.push({ ...entry, sourceMap: await map.json() });
      }
    };
    const navigate = async (url) => {
      await capture();
      if (process.env.YARD_UI_COVERAGE === '1') await page.coverage.startJSCoverage({ resetOnNavigation: false });
      return url ? page.goto(url) : page.reload();
    };
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
    await page.route('**/app/api/research/ideas', (route) =>
      route.fulfill({
        json: {
          items: [
            sourceFixture,
            {
              ...sourceFixture,
              slug: 'second-idea',
              title: 'Another project idea',
              url: 'https://startuptribunal.com/catalog/second-idea',
              blueprint_url: 'https://startuptribunal.com/catalog/second-idea',
            },
          ].map((row) => ({
            title: row.title,
            slug: row.slug,
            problem_statement: row.problem_statement,
            target_customer: row.target_customer,
            catalog_decision: row.catalog_decision,
            catalog_caveat: row.catalog_caveat,
            catalog_reason_codes: row.catalog_reason_codes,
            url: `https://startuptribunal.com/catalog/${row.slug}`,
            blueprint_url: `https://startuptribunal.com/catalog/${row.slug}`,
          })),
          attribution: {
            required: true,
            text: 'Research by StartupTribunal',
            url: 'https://startuptribunal.com/catalog',
          },
        },
      }),
    );
    await page.goto('http://localhost:3001/app');
    assert.equal(new URL(page.url()).pathname, '/app/');
    await page.getByLabel('Access code').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Buyer', exact: true }).count(), 0);
    await accessible(page, `${name}: sign-in`);
    await page.getByLabel('Access code').fill(code);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByText('Signed in as the buyer.', { exact: true }).waitFor();
    assert.doesNotMatch(await page.locator('main').innerText(), /Choose a simulated operator|mock journey/);
    await page.getByRole('button', { name: 'The Board', exact: true }).click();
    await page.getByRole('heading', { name: 'Pick work. Stand behind it.' }).waitFor();
    assert.equal(await page.locator('.board-panel .signal').innerText(), 'LIVE BOARD');
    await page.getByRole('button', { name: 'Describe a project', exact: true }).click();
    await page.locator('.idea-card').first().waitFor();
    assert.equal(await page.locator('.idea-card').count(), 2, 'ideas load automatically');
    await page.getByLabel('Search ideas').fill('not-a-match');
    await page.getByText('No ideas match this search.', { exact: true }).waitFor();
    await page.getByLabel('Search ideas').fill('');
    await page.getByRole('button', { name: 'View idea →' }).first().click();
    await page.locator('.idea-detail').waitFor();
    assert.match(await page.locator('.idea-detail').innerText(), /Source decision: rejected/);
    assert.equal(await page.getByLabel('What are we building?').count(), 0, 'viewing an idea creates no intake');
    await accessible(page, `${name}: idea gallery/detail`);
    await page.screenshot({ path: `/out/yard-ideas-${name}.png`, fullPage: true });
    await page.locator('.idea-detail').getByRole('button', { name: 'Use this idea in a private intake' }).click();
    await page.getByLabel('What are we building?').waitFor();
    assert.match(await page.getByLabel('What are we building?').inputValue(), /Tribunal decision: rejected/);
    await navigate();
    await page.getByRole('heading', { name: 'Review your project brief.', exact: true }).waitFor();
    await navigate('http://localhost:3001/app/');
    await page.getByRole('button', { name: 'Start a private intake', exact: true }).click();
    await page.getByLabel('What are we building?').fill('A booking tool for my customers');
    await page.getByRole('button', { name: 'Review my brief', exact: true }).click();
    await page.getByRole('heading', { name: 'Review your project brief.', exact: true }).waitFor();
    assert.match(await page.getByLabel('Saved what are we building?').inputValue(), /booking tool/);
    await navigate();
    await page.getByRole('heading', { name: 'Review your project brief.', exact: true }).waitFor();
    await navigate('http://localhost:3001/app/');
    await page.getByText('Import a full research report', { exact: true }).click();

    await page.getByLabel('Startup Tribunal JSON').fill(fixture);
    await page.getByRole('button', { name: 'Review imported idea' }).click();
    await page.getByRole('heading', { name: 'What Yard understood' }).waitFor();
    assert.match(await page.locator('.tribunal-import').innerText(), /rejected/);
    await page.getByText('Private metadata was removed from this research before review.', { exact: true }).waitFor();
    await accessible(page, `${name}: research preview`);
    await page.screenshot({ path: `/out/yard-import-${name}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Use this idea in a private intake' }).click();
    await page.getByLabel('What are we building?').waitFor();
    assert.match(await page.getByLabel('What are we building?').inputValue(), /ShieldVC/);
    assert.equal(await page.getByLabel('Access code').count(), 0);
    const id = new URL(page.url()).searchParams.get('intake');
    assert(id);
    await navigate();
    await page.getByText('Signed in as the buyer.', { exact: true }).waitFor();
    await page.getByRole('heading', { name: 'Review your project brief.', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Edit choices', exact: true }).click();
    await page.getByLabel('What are we building?').waitFor();
    assert.match(await page.getByLabel('What are we building?').inputValue(), /Tribunal decision: rejected/);
    assert.equal(await page.locator('.optional-field[open]').count(), 0, 'secondary first-step fields are disclosed');
    await page.getByRole('button', { name: 'Review my brief', exact: true }).click();
    await page.getByRole('heading', { name: 'Review your project brief.', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Edit choices', exact: true }).click();
    await page.getByLabel('What are we building?').waitFor();
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
    if (process.env.YARD_UI_COVERAGE === '1') {
      await capture();
      assert(mapped.length > 0, 'app browser coverage must not be empty');
      writeFileSync(`/out/coverage-${name}.json`, JSON.stringify(mapped));
    }
    await context.close();
  }
} finally {
  await browser.close();
}
