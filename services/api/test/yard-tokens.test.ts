import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const file = (path: string) => readFileSync(path, 'utf8');
const ratio = (a: string, b: string) => {
  const luminance = (hex: string) => {
    const channels = [1, 3, 5]
      .map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
  };
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
it('shares dark/paper tokens and recomputes documented AA foreground contrast', () => {
  const css = file('site/yard/tokens.css');
  const values = Object.fromEntries([...css.matchAll(/--y-([a-z0-9-]+):\s*(#[a-f0-9]{6})/gi)].map((m) => [m[1], m[2]]));
  const doc = file('docs/yard/Y17-design-system.md');
  for (const name of ['chalk', 'weld', 'blueprint', 'hivis', 'steel', 'rebar']) {
    const row = new RegExp(`\\| ${name} \\| ([0-9.]+) \\| ([0-9.]+) \\|`).exec(doc)!;
    for (const [i, canvas] of ['navy', 'navy-2'].entries()) {
      const measured = ratio(values[name]!, values[canvas]!);
      expect(measured).toBeGreaterThanOrEqual(4.5);
      expect(Math.abs(measured - Number(row[i + 1]))).toBeLessThan(0.11);
    }
  }
  for (const name of ['navy', 'blueprint-ink', 'hivis-ink', 'steel-ink', 'rebar-ink'])
    expect(ratio(values[name]!, values.paper!)).toBeGreaterThanOrEqual(4.5);
  expect(css).toContain('[data-theme="paper"]');
  expect(file('site/yard/styles.css')).toContain('@import "./tokens.css"');
});
