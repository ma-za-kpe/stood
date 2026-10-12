import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkPortal } from './check-portal.mjs';

test('finds a placeholder in a nested generated page and requires working owner styles', () => {
  const root = mkdtempSync(join(tmpdir(), 'stood-portal-'));
  try {
    mkdirSync(join(root, 'typescript/models'), { recursive: true });
    mkdirSync(join(root, 'static/css'), { recursive: true });
    writeFileSync(join(root, 'index.html'), '<meta http-equiv="refresh" content="0">');
    const page = join(root, 'typescript/models/example.html');
    const html =
      '<div class="portal-footer">Maku Mazakpe <a href="mailto:makpalyy@gmail.com">Support</a></div><link href="https://ma-za-kpe.github.io/stood/api/static/css/creator.css">';
    writeFileSync(page, html.replace('makpalyy@gmail.com', 'support@yourcompany.com'));
    assert.throws(() => checkPortal(root), /Contact placeholder/);
    writeFileSync(page, html.replace('static/css/creator.css', 'missing.css'));
    assert.throws(() => checkPortal(root), /Missing footer styles/);
    writeFileSync(page, html);
    assert.throws(() => checkPortal(root), /ENOENT/);
    writeFileSync(join(root, 'static/css/creator.css'), '.creator-footer { padding: 24px; }');
    assert.equal(checkPortal(root), 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
