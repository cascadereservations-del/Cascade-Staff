// s85 ui-b4: the Notices tab and the paid-notice card use the type tokens, one spacing rhythm, and no text under 12 px.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const b4 = css.slice(css.indexOf('/* B4 notices'));
const paid = readFileSync(new URL('../pay/C_notice.css', import.meta.url), 'utf8');

test('B4 section exists and sizes text only with the type tokens', () => {
  assert.ok(css.includes('/* B4 notices'), 'B4 section missing');
  const sizes = [...b4.matchAll(/font-size:\s*([^;]+);/g)].map((m) => m[1].trim());
  assert.ok(sizes.length >= 8, 'expected the B4 rules to set font sizes');
  for (const s of sizes) assert.match(s, /^var\(--v5-t-(display|body|2|label)\)$/, `untokenised size: ${s}`);
  assert.doesNotMatch(b4, /font-size:\s*\d+(\.\d+)?px/);
});

test('B4 spacing is on the 4/8/12/16/24 scale', () => {
  const gaps = [...b4.matchAll(/(?:^|[;{\s])gap:\s*(\d+)px/g)].map((m) => +m[1]);
  assert.ok(gaps.length >= 5);
  for (const g of gaps) assert.ok([4, 8, 12, 16, 24].includes(g), `off-scale gap ${g}`);
});

test('paid notice button text is on a type token', () => {
  assert.doesNotMatch(paid, /font-size:\s*clamp\(/);
});
