// s95 returning-guest tiers (Staff 3.4.11): the pure helpers in lib.js and the way app.js draws them on the Today and guest cards.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const CS = createRequire(import.meta.url)('../lib.js');

test('tierLabel: the three tiers map to chip text, everything else draws nothing', () => {
  assert.equal(CS.tierLabel('returning'), 'Returning');
  assert.equal(CS.tierLabel('regular'), 'Regular');
  assert.equal(CS.tierLabel('vip'), 'VIP');
  for (const x of [null, undefined, '', 'gold', 'VIP', 0]) assert.equal(CS.tierLabel(x), null, String(x));
});

test('tierLine: trimmed text only with a known tier; null and blank draw nothing', () => {
  assert.equal(CS.tierLine({ tier: 'regular', tier_line: '  Late checkout when free  ' }), 'Late checkout when free');
  assert.equal(CS.tierLine({ tier: 'vip', tier_line: null }), null);
  assert.equal(CS.tierLine({ tier: 'vip', tier_line: '   ' }), null);
  assert.equal(CS.tierLine({ tier: null, tier_line: 'Orphan line' }), null);
  assert.equal(CS.tierLine({ tier: 'vip', tier_line: 5 }), null);
  assert.equal(CS.tierLine(null), null);
});

test('app.js: Today card and guest block draw the chip beside the name and the line under it, escaped', () => {
  const app = read('app.js');
  assert.match(app, /function tierChip\(g\)[^\n]*CS\.tierLabel\(g && g\.tier\)/);
  assert.match(app, /function tierLineP\(g\)[^\n]*esc\(l\)/);
  assert.match(app, /<h2 class="A_name">' \+ esc\(g\.guest_name \|\| 'Guest'\) \+ '<\/h2>' \+ tierChip\(g\) \+ '<\/div>' \+ tierLineP\(g\)/);
  assert.match(app, /<h3 class="ttl">' \+ esc\(g\.guest_name \|\| 'Guest'\) \+ '<\/h3>' \+ tierChip\(g\) \+ '<\/div>' \+ tierLineP\(g\)/);
});
