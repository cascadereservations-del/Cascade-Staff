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

test('app.js uses CS.tierParts in both cards, in the name row and under it', () => {
  const app = read('app.js');
  assert.match(app, /CS\.tierParts\(g, compact, pill\)/);
  assert.match(app, /<h2 class="A_name">' \+ esc\(g\.guest_name \|\| 'Guest'\) \+ '<\/h2>' \+ tp\.ret \+ '<\/div><\/div>' \+ A_face\(g\)/); // s98: face beside name + chip, the benefits line full width under it
  assert.match(app, /A_perks\(g, st\.kind, tp\) \+ \(nl \?/); // s105: the perks checklist replaces the grey benefits line on the Today card
  assert.match(app, /<h3 class="ttl">' \+ esc\(g\.guest_name \|\| 'Guest'\) \+ '<\/h3>' \+ tp\.chip \+ '<\/div>' \+ tp\.line/);
});

const pill = (tone, icon, text) => '<span class="pill p-' + tone + '">' + icon + CS.esc(text) + '</span>';
test('tierParts: tier + line shows once (no older Returning pill); no tier keeps the older pill; hostile line is escaped', () => {
  const a = CS.tierParts({ tier: 'regular', tier_line: 'Late checkout when free', repeat: true, stay_count: 3 }, true, pill);
  assert.match(a.chip, /Regular/); assert.match(a.line, /Late checkout when free/); assert.equal(a.ret, '');
  const b = CS.tierParts({ tier: null, repeat: true, stay_count: 3 }, true, pill);
  assert.equal(b.chip, ''); assert.equal(b.line, ''); assert.match(b.ret, /Returning · 3rd stay/);
  const c = CS.tierParts({ tier: 'vip', tier_line: '<img src=x onerror=1>' }, false, pill);
  assert.ok(!c.line.includes('<img')); assert.match(c.line, /&lt;img src=x onerror=1&gt;/);
  const d = CS.tierParts({ tier: 'vip', tier_line: null, repeat: true, stay_count: 2 }, false, pill);
  assert.match(d.chip, /star/); assert.match(d.chip, /p-tier-vip/); assert.equal(d.ret, '', 's96: a tier chip means no older Returning pill');
});

test('guests list chip: only vip gets a glyph (no check mark shared with ID on file)', () => {
  assert.match(read('guests/G_guests.js'), /\(tier === 'vip' \? G_glyph\('star'\) : ''\) \+ l/);
});
