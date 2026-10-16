// s89 L3: pure chart functions. No DOM needed; they return strings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const C = createRequire(import.meta.url)(path.join(root, 'manage', 'N_charts.js'));
const CSS = fs.readFileSync(path.join(root, 'manage', 'N_charts.css'), 'utf8');
const clean = (s) => { assert.ok(!/NaN|undefined|Infinity|\bnull\b/.test(s), 'bad token in: ' + s.slice(0, 200)); return s; };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

test('formatting: PHP money and points', () => {
  assert.equal(C.formatPHP(1234567.8), '₱1,234,568');
  assert.equal(C.formatPHP(950.5), '₱950.50');
  assert.equal(C.formatPHP(-2500), '−₱2,500');
  assert.equal(C.formatPHP(null), '—');
  assert.equal(C.formatPHP(NaN), '—');
  assert.equal(C.formatPoints(-3.24), '−3.2 pt');
  assert.equal(C.formatDelta(12), '+12%');
  assert.equal(C.formatDelta(0), '0%');
});
test('kpiTile: empty data renders without NaN', () => {
  const h = clean(C.kpiTile({ title: 'RevPAR', value: null, spark: [] }));
  assert.match(h, /—/);
  assert.ok(!/C_chips/.test(h));
  clean(C.kpiTile());
  clean(C.kpiTile({ title: 'x', value: NaN, spark: [null, null] }));
});
test('kpiTile: single point is a dot, gaps split the line', () => {
  assert.match(C.kpiTile({ title: 'a', value: 1, spark: [5] }), /C_sdot/);
  const g = C.kpiTile({ title: 'a', value: 1, spark: [1, 2, null, 3, 4] });
  assert.equal((g.match(/class="C_sline"/g) || []).length, 2);
});
test('kpiTile: polarity colours by meaning', () => {
  const dn = C.kpiTile({ title: 'Cancellation rate', value: '4%', deltaPrev: -20, goodWhen: 'down' });
  assert.match(dn, /C_chip C_good/);
  assert.ok(dn.includes('▼') && dn.includes('−20%'));
  assert.match(C.kpiTile({ title: 'c', value: 1, deltaPrev: 5, goodWhen: 'down' }), /C_chip C_bad/);
  assert.match(C.kpiTile({ title: 'o', value: 1, deltaPrev: 5, goodWhen: 'up' }), /C_chip C_good/);
  assert.match(C.kpiTile({ title: 'o', value: 1, deltaPrev: -5, goodWhen: 'up' }), /C_chip C_bad/);
  const nu = C.kpiTile({ title: 'Lead time', value: 9, deltaPrev: 50, goodWhen: 'neutral' });
  assert.match(nu, /C_chip C_flat/);
  assert.ok(!/C_chip C_(good|bad)/.test(nu));
  assert.match(C.kpiTile({ title: 'z', value: 1, deltaPrev: 0, goodWhen: 'up' }), /C_chip C_flat/);
});
test('kpiTile: null YoY chip hidden, present chip has aria-label', () => {
  const h = C.kpiTile({ title: 'ADR', value: '₱3,000', deltaPrev: 4.2, deltaYoY: null, goodWhen: 'up' });
  assert.ok(!/vs last year/.test(h));
  assert.match(h, /aria-label="vs previous: up 4\.2%"/);
  assert.match(C.kpiTile({ title: 'ADR', value: 1, deltaPrev: 1, deltaYoY: { v: -2, unit: 'pt' }, goodWhen: 'up' }), /vs last year: down 2 pt/);
});
test('kpiTile: html in title is escaped', () => assert.ok(!C.kpiTile({ title: '<b>x</b>', value: 1 }).includes('<b>')));
test('monthBars: empty and single month', () => {
  assert.match(clean(C.monthBars({ months: [] })), /No monthly data/);
  assert.match(clean(C.monthBars()), /No monthly data/);
  const one = clean(C.monthBars({ months: [{ label: 'Oct', value: 1000, lastYear: null, occupancy: 50 }] }));
  assert.match(one, /role="img"/);
  assert.ok(!/class="C_ly"/.test(one));
});
test('monthBars: aria summary, hidden table, 12 months, gaps', () => {
  const months = MON.map((label, i) => ({ label, value: i === 3 ? null : 1000 * (i + 1), lastYear: i % 2 ? 800 * i : null, occupancy: i === 5 ? null : 40 + i }));
  const h = clean(C.monthBars({ months }));
  assert.match(h, /aria-label="12 months\. Highest: Dec, ₱12,000/);
  assert.equal((h.match(/<th scope="row">/g) || []).length, 12);
  assert.match(h, /class="C_sr"/);
  assert.match(h, /No data/);
  assert.equal((h.match(/class="C_bar( C_on)?"/g) || []).length, 11);
  assert.match(clean(C.monthBars({ months: [{ label: 'Jan', value: 0, lastYear: 0, occupancy: 0 }] })), /No figures yet/);
});
test('kpiTile: chips name the compared period; defaults stay for old callers; last spark point is a dot', () => {
  const h = C.kpiTile({ title: 'ADR', value: 1, spark: [1, 2, 3], deltaPrev: 4, deltaYoY: -2, prevLabel: 'vs Aug', yoyLabel: 'vs Sep 2025', goodWhen: 'up' });
  assert.match(h, /class="C_vs">vs Aug</); assert.match(h, /vs Sep 2025: down 2%/); assert.match(h, /vs Aug: up 4%/);
  assert.match(C.kpiTile({ title: 'a', value: 1, deltaPrev: 1, deltaYoY: 1 }), /vs previous.*vs last year/);
  assert.equal((h.match(/class="C_sdot"/g) || []).length, 1);
  assert.ok(!/C_sdot/.test(C.kpiTile({ title: 'a', value: 1, spark: [1, 2, null] })), 'no dot when the newest month has no value');
});
test('monthBars: newest bar highlighted, tap caption, grid, occupancy line, last-year marks', () => {
  const months = [{ label: 'Aug', title: 'Aug 2026', value: 1000, lastYear: 800, occupancy: 50 }, { label: 'Sep', title: 'Sep 2026', value: 2000, lastYear: 1500, occupancy: 75 }];
  const h = clean(C.monthBars({ months }));
  assert.equal((h.match(/class="C_bar C_on"/g) || []).length, 1);
  assert.match(h, /role="status"[^>]*>Sep 2026: ₱2,000 · same month last year ₱1,500 · occupancy 75%</);
  assert.equal((h.match(/class="C_grid"/g) || []).length, 3); assert.match(h, /class="C_oline"/); assert.equal((h.match(/class="C_ly"/g) || []).length, 2);
  assert.equal((h.match(/class="C_hit"[^>]*data-n="mon"/g) || []).length, 2); assert.match(h, /class="C_max"[^>]*>₱2,000</);
  const first = clean(C.monthBars({ months, sel: 0 })); assert.match(first, /role="status"[^>]*>Aug 2026: ₱1,000/); assert.match(first, /aria-pressed="true"/);
  assert.match(clean(C.monthBars({ months, sel: 9 })), /role="status"[^>]*>Sep 2026/, 'a stale selection falls back to the newest');
});
test('paceCard: empty, ahead/behind, null capacity', () => {
  assert.match(clean(C.paceCard({ nextMonths: [] })), /No upcoming/);
  const h = clean(C.paceCard({ nextMonths: [{ label: 'Nov', booked: 12, bookedLastYear: 8, capacity: 30 }, { label: 'Dec', booked: 5, bookedLastYear: 9, capacity: 31 }, { label: 'Jan', booked: null, bookedLastYear: null, capacity: 0 }] }));
  assert.match(h, /Nov: 12 of 30 nights, 4 ahead of last year/);
  assert.match(h, /Dec: 5 of 31 nights, 4 behind last year/);
  assert.match(h, /Jan: No data/);
  assert.equal((h.match(/class="C_mark"/g) || []).length, 2);
});
test('css: tokens only, no hard-coded colours, reduced motion honoured', () => {
  assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(CSS));
  assert.match(CSS, /prefers-reduced-motion/);
});
