import { createHash } from 'node:crypto';
import type { AcceptanceCase } from '@stood/yard-domain';
import { renderAcceptanceTest } from '@stood/yard-foreman';

// The judge demo's prewritten project: a tiny café website built page by page. Each task's frozen tests run the
// Crew's program (`node src/cli.js page <name>`) and expect that page's HTML, through Stood's isolated runner.
export const DEMO_BUDGET_MINOR = 100;
export const DEMO_TASKS = [
  {
    id: 'home',
    name: 'Home page',
    cases: [
      {
        name: 'home page shows the café name',
        args: ['page', 'home'],
        input: '',
        status: 0,
        output: '<h1>Sunrise Café</h1>',
        match: 'includes',
      },
      {
        name: 'home page links to the menu',
        args: ['page', 'home'],
        input: '',
        status: 0,
        output: '<a href="menu.html">',
        match: 'includes',
      },
    ],
  },
  {
    id: 'menu',
    name: 'Menu page',
    cases: [
      {
        name: 'menu lists the flat white with its price',
        args: ['page', 'menu'],
        input: '',
        status: 0,
        output: 'Flat white — $4.50',
        match: 'includes',
      },
      {
        name: 'menu lists the croissant with its price',
        args: ['page', 'menu'],
        input: '',
        status: 0,
        output: 'Butter croissant — $3.25',
        match: 'includes',
      },
    ],
  },
  {
    id: 'contact',
    name: 'Contact page',
    cases: [
      {
        name: 'contact page has a message form',
        args: ['page', 'contact'],
        input: '',
        status: 0,
        output: '<form',
        match: 'includes',
      },
      {
        name: 'contact page shows the email address',
        args: ['page', 'contact'],
        input: '',
        status: 0,
        output: 'hello@sunrise.cafe',
        match: 'includes',
      },
    ],
  },
] as const satisfies readonly { id: string; name: string; cases: readonly AcceptanceCase[] }[];
export type DemoTask = (typeof DEMO_TASKS)[number];

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Frozen tests for one run (one file per task), with the same hashes Stood computes over the files at the base.
export function demoTests(runId: string) {
  return DEMO_TASKS.map((task) => {
    const path = `tests/demo-${runId}-${task.id}.test.js`;
    const content = renderAcceptanceTest(task.cases.map((c) => ({ ...c, args: [...c.args] })));
    const tests = [{ id: task.id, path }];
    return {
      task,
      path,
      content,
      tests,
      testIds: [task.id],
      testBundleHash: hash([{ path, content }]),
      manifestHash: hash(tests),
    };
  });
}

// The Crew's "build": the whole site with every page up to and including `upTo`, as plain files. CommonJS with no
// package.json, so the build adds no dependency and never touches tests/ or .github/ (Stood refuses both).
export function demoSite(upTo: number): Record<string, string> {
  const done = DEMO_TASKS.slice(0, upTo + 1).map((t) => t.id);
  const pages: Record<string, string> = {
    home: `<h1>Sunrise Café</h1>
<p>Fresh coffee and pastries, every morning from 7.</p>
<nav><a href="menu.html">Menu</a> · <a href="contact.html">Contact</a></nav>`,
    menu: `<h2>Menu</h2>
<ul>
  <li>Flat white — $4.50</li>
  <li>Espresso — $3.00</li>
  <li>Butter croissant — $3.25</li>
</ul>`,
    contact: `<h2>Contact</h2>
<p>Write to us at hello@sunrise.cafe</p>
<form action="mailto:hello@sunrise.cafe" method="post">
  <label>Your message <textarea name="message"></textarea></label>
  <button type="submit">Send</button>
</form>`,
  };
  const built = Object.fromEntries(done.map((id) => [id, pages[id]]));
  const head =
    '<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sunrise Café</title>\n<style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem;color:#1d1a16;background:#fbf6ee}h1{color:#b4541a}</style>\n</head>\n<body>\n';
  const tail = '\n</body>\n</html>\n';
  const layout = (body: string) => head + body + tail;
  const files: Record<string, string> = {
    'src/site.js': `// Built by the Yard demo Crew, one page per task.
const pages = ${JSON.stringify(built, null, 2)};
const head = ${JSON.stringify(head)};
const tail = ${JSON.stringify(tail)};
const layout = (body) => head + body + tail;
module.exports = { pages, layout };
`,
    'src/cli.js': `// Usage: node src/cli.js page <name>
const { pages, layout } = require('./site.js');
const [command, name] = process.argv.slice(2);
if (command !== 'page' || !Object.hasOwn(pages, name)) {
  process.stderr.write('Unknown page\\n');
  process.exit(1);
}
process.stdout.write(layout(pages[name]));
`,
  };
  for (const id of done) files[`public/${id === 'home' ? 'index' : id}.html`] = layout(built[id] as string);
  return files;
}
