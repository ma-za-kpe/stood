// Assembles the GitHub Pages site into _site/:
// copies site/ and docs/brand/, injects the version, renders CHANGELOG.md into changelog.html.
// Usage: npm ci --prefix tools/site && node tools/site/build.mjs
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { marked } from 'marked';

const OUT = '_site';
rmSync(OUT, { recursive: true, force: true });
mkdirSync(`${OUT}/assets`, { recursive: true });
cpSync('site', OUT, { recursive: true });
if (!existsSync('apps/yard-web/dist/index.html')) throw new Error('Build @stood/yard-web before assembling the site');
cpSync('apps/yard-web/dist', `${OUT}/yard/app`, { recursive: true });
cpSync('docs/brand', `${OUT}/assets/brand`, { recursive: true });
writeFileSync(`${OUT}/.nojekyll`, '');

const version = existsSync('version.txt') ? readFileSync('version.txt', 'utf8').trim() : '0.0.0';
const changelogMd = existsSync('CHANGELOG.md')
  ? readFileSync('CHANGELOG.md', 'utf8')
  : '# Changelog\n\nNo releases yet. The first release (v0.1.0) is coming.\n';
const changelogHtml = marked.parse(changelogMd.replace(/^# Changelog\s*/i, ''));

for (const file of ['index.html', 'changelog.html']) {
  const path = `${OUT}/${file}`;
  const html = readFileSync(path, 'utf8')
    .replaceAll('{{VERSION}}', `v${version}`)
    .replace('<!--CHANGELOG-->', changelogHtml);
  writeFileSync(path, html);
}
console.log(`site built: v${version}, changelog ${changelogMd.length} chars`);
