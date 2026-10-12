import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function checkPortal(root) {
  let pages = 0;
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.name.endsWith('.html')) {
        const html = readFileSync(file, 'utf8');
        assert.doesNotMatch(
          html,
          /support@yourcompany\.com|YourCompanyInc|Your Company,? Inc\.?/i,
          `Contact placeholder in ${file}`,
        );
        if (html.includes('class="portal-footer"')) {
          assert.match(html, /mailto:makpalyy@gmail\.com/, `Missing owner support in ${file}`);
          assert.match(html, /Maku Mazakpe/, `Missing creator in ${file}`);
          const links = [...html.matchAll(/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)].map((match) => match[1]);
          assert.ok(
            links.includes('https://ma-za-kpe.github.io/stood/api/static/css/creator.css'),
            `Missing footer styles in ${file}`,
          );
          pages++;
        }
      }
    }
  };
  visit(root);
  assert.ok(pages > 0, 'No portal content pages checked');
  assert.match(
    readFileSync(join(root, 'static/css/creator.css'), 'utf8'),
    /\.creator-footer/,
    'Missing generated footer stylesheet',
  );
  return pages;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  console.log(`Portal creator/contact checked on ${checkPortal(process.argv[2])} pages.`);
