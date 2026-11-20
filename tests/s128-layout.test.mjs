// s128 (Staff 3.4.45): layout and copy on the KPI Utility tiles, the Admin bill cards and the Today bills card (Lloyd, live screenshots at 360 px, 2026-11-20).
// Hand-computed expectations. Layout itself (wraps, overflow, tap size, contrast) was measured in a real Chromium; these tests pin the copy and the states.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { read, boot, baseHandlers } from './_a_harness.mjs';

const tick = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const NB = ' ';
const text = (h) => h.replace(/<[^>]*>/g, " ").replace(/[ \t\n]+/g, " ").trim();
function mountWith(data, role = 'owner') {
  const w = { ICON: () => '', document: {} }; w.window = w; vm.runInContext(read('kpi/K_kpi.js'), vm.createContext(w));
  const L = {}, el = { innerHTML: '', addEventListener: (t, f) => { (L[t] ||= []).push(f); }, removeEventListener() {}, querySelector: () => null };
  w.K_Kpi.reset(); w.K_Kpi.mount(el, { client: { rpc: (n) => Promise.resolve(n === 'kpi_tab_v1' ? { data, error: null } : { data: [], error: null }) }, role, propertyId: 'p' });
  const click = async (attrs) => { const t = { getAttribute: (n) => attrs[n] ?? null, closest: () => t }; for (const f of L.click || []) f({ target: t, preventDefault() {} }); await tick(); };
  return { el, click };
}
const pm = (kwhDay, m3Day) => [{ month: '2026-10', stays: 3, kwh: 30, m3: 1, kwh_per_stay: 10, m3_per_stay: 0.3, kwh_per_day: kwhDay, m3_per_day: m3Day }];
const util = (u) => Object.assign({ kwh_month: 214, kwh_per_day: 11.3, m3_month: 3.5, m3_per_day: 0.18, nights_booked: 17, nights_in_month: 30,
  last_reading: { recorded_at: '2026-11-19T02:00:00Z', delta_kwh: 10, days: 1, kwh_per_day: 10, delta_m3: 0.11, m3_per_day: 0.11, flag: null },
  per_stay: [], per_month: pm(11.25, 0.18), brownouts: { count: 0, hours: 0 }, water_cuts: { count: 0, hours: 0 } }, u || {});
const payload = (u) => ({ ok: true, month: '2026-11-01', utility: util(u), inventory: {} });
const html = async (u) => { const m = mountWith(payload(u), 'cleaner'); await tick(); return m.el.innerHTML; };
const cardOf = (h, id) => { const i = h.indexOf('id="' + id + '"'); assert.ok(i > 0, id + ' is drawn'); const rest = h.slice(i).split('<p class="KU_means"')[0]; const j = rest.indexOf('<div class="card glass', 10); return j > 0 ? rest.slice(0, j) : rest; };

test('s128 pill: the three words, the month in three letters, nothing about "about"', async () => {
  // 11.3 vs 11.25 is +0.4%: the same; 0.12 vs 0.18 is -33%; 12.3 vs 11.25 is +9%
  let h = await html({}); assert.match(cardOf(h, 'K_tE'), /KU_chip KU_chip-same">same as Oct</);
  h = await html({ m3_per_day: 0.12 }); assert.match(cardOf(h, 'K_tW'), /KU_chip KU_chip-down">down 33% vs Oct</);
  h = await html({ kwh_per_day: 12.3 }); assert.match(cardOf(h, 'K_tE'), /KU_chip KU_chip-up">up 9% vs Oct</);
  assert.doesNotMatch(h, /about the same as (Oct|October)|vs October/);
  assert.match(read('kpi/K_kpi.css'), /\.KU_chip \{[^}]*white-space: nowrap/, 'one line');
});

test('s128 sub line: "N kWh this month", number and unit glued, balanced wrap', async () => {
  const h = await html({});
  assert.ok(cardOf(h, 'K_tE').includes('<span class="K_sub">214' + NB + 'kWh this month</span>'));
  assert.ok(cardOf(h, 'K_tW').includes('<span class="K_sub">3.5' + NB + 'm³ this month</span>'));
  assert.doesNotMatch(h, /used this month/);
  assert.match(read('kpi/K_kpi.css'), /\.KU_tile \.K_sub \{ text-wrap: balance/);
});

test('s128 Nights booked is one full-width row: ring, then "17 of 30 nights" that cannot break', async () => {
  const h = await html({}), n = cardOf(h, 'K_tN');
  assert.match(n, /^id="K_tN"|id="K_tN"/); assert.ok(h.includes('class="card glass KU_row KU_row-ring" id="K_tN"'));
  assert.ok(n.includes('<b>57%</b>') && n.includes('<span class="KU_rowv">17' + NB + 'of' + NB + '30' + NB + 'nights</span>'));
  assert.ok(!n.includes('17 of 30'), 'no breakable spaces inside the figure');
  assert.match(read('kpi/K_kpi.css'), /\.KU_row \{ grid-column: 1 \/ -1;/);
  assert.match(cardOf(await html({ nights_booked: null }), 'K_tN'), /Nights booked<\/span><span class="KU_big"><b>Not yet/);
});

test('s128 Last reading: one day drops the "a day" repeat, three days keeps it; the check flag stays', async () => {
  let t = text(cardOf(await html({}), 'K_last'));
  assert.equal(t, 'id="K_last"> Last reading 19 Nov over 1 day ⚡ Electricity 10' + NB + 'kWh 💧 Water 0.11' + NB + 'm³');
  const three = { last_reading: { recorded_at: '2026-11-19T02:00:00Z', delta_kwh: 38.2, days: 3, kwh_per_day: 12.7, delta_m3: 1.3, m3_per_day: 0.43, flag: 'check' } };
  const h3 = await html(three), c3 = cardOf(h3, 'K_last'); t = text(c3);
  assert.equal(t, 'id="K_last"> Last reading 19 Nov over 3 days ⚡ Electricity 38.2' + NB + 'kWh · 12.7' + NB + 'a' + NB + 'day 💧 Water 1.3' + NB + 'm³ · 0.43' + NB + 'a' + NB + 'day This reading is being checked.');
  assert.ok(c3.includes('K_warn KU_lflag'), 'the flag line is still there');
  assert.ok(h3.includes('class="card glass KU_row KU_row-last" id="K_last"'));
  assert.match(read('kpi/K_kpi.css'), /\.KU_row \{[^}]*font-variant-numeric: tabular-nums/);
});

// ---- the Today bills card
const BILLS = (e, w) => () => ({ error: null, data: { since: '2026-10-21', last_reading_at: '2026-11-19T02:00:00Z', electric: e, water: w } });
const todayHtml = async (bills) => { const app = await boot({ role: 'owner', hash: '#home', handlers: baseHandlers('owner', { today_bills_v1: bills }) }); return app.els['v-home'].innerHTML; };
const billsCard = (h) => { const i = h.indexOf('id="T_bills"'); const r = h.slice(i); return r.slice(0, r.indexOf('</section>')); };

test('s128 Today bills card: with a rate it keeps the pesos and says "at the latest rates"', async () => {
  const c = billsCard(await todayHtml(BILLS({ php: 4314.35, kwh: 331 }, { php: 212, m3: 6 })));
  assert.ok(c.includes('₱4,314') && c.includes('331' + NB + 'kWh') && c.includes('₱212') && c.includes('6' + NB + 'm³'));
  assert.ok(c.includes('up to 19' + NB + 'Nov, at the latest rates.'));
  assert.doesNotMatch(c, /Not yet|Cost shows when/);
});

test('s128 Today bills card: electricity with kWh and no peso shows the kWh, one honest line, and no rate caption', async () => {
  const c = billsCard(await todayHtml(BILLS({ php: null, kwh: 331 }, { php: 212, m3: 6 })));
  assert.doesNotMatch(c, /Not yet/);
  assert.ok(c.includes('<b>331' + NB + 'kWh</b>'), 'the kWh are the big figure');
  assert.equal((c.match(/Cost shows when the rate is in\./g) || []).length, 1, 'said once, on the electricity side only');
  assert.ok(c.includes('From the meter readings up to 19' + NB + 'Nov.</p>') && !c.includes('latest rates'), 'no rate claim');
  assert.ok(c.includes('₱212'), 'water keeps its peso');
});

// ---- the Admin bill cards use the same wording
test('s128 Admin bill card: no peso shows the usage and "Cost shows when the rate is in.", never "Not yet" beside a rate caption', async () => {
  const admin = { rate: null, sold_nights: 12, cost: {}, meter: {},
    bills: { electric: { cycle_from: '2026-10-21', cycle_to: '2026-11-21', days: 29, days_in_cycle: 31, kwh: 383, rate: null, so_far_php: null, forecast_kwh: 409, forecast_php: null, last_reading_at: '2026-11-19T02:00:00Z' },
      water: { cycle_from: '2026-10-21', cycle_to: '2026-11-21', days: 29, m3: 7.2, so_far_php: null, forecast_m3: 7.7, forecast_php: null, min_php: 212, min_m3: 10 } } };
  const m = mountWith(Object.assign(payload({}), { admin }), 'owner'); await tick(); await m.click({ 'data-kact': 'seg', 'data-seg': 'admin' });
  const h = m.el.innerHTML;
  for (const id of ['K_bill', 'K_wbill']) { const c = cardOf(h, id); assert.doesNotMatch(c, /Not yet/, id); assert.ok(c.includes('Cost shows when the rate is in.'), id); }
  assert.ok(cardOf(h, 'K_bill').includes('<b>383' + NB + 'kWh</b>') && cardOf(h, 'K_bill').includes('<b>about 409' + NB + 'kWh</b>'));
  assert.ok(cardOf(h, 'K_wbill').includes('<b>7.2' + NB + 'm³</b>'));
});

test('s128 release is 3.4.45 with cs-shell-v70, in both pins', () => {
  assert.equal(JSON.parse(read('package.json')).version, '3.4.45'); assert.match(read('app.js'), /version: '3\.4\.45'/);
  assert.match(read('sw.js'), /CACHE_NAME = 'cs-shell-v70'/); assert.match(read('app.js'), /var PC_SHELL = 'cs-shell-v70';/);
});

test('s128 nowrap stays on an allowlist in the KPI sheet, and the Utility tiles stack at 340 px and under (Opus review)', () => {
  const css = read('kpi/K_kpi.css');
  const owners = [...css.matchAll(/([^{}]+)\{[^{}]*white-space\s*:\s*nowrap[^{}]*\}/g)].map((m) => m[1].trim()).sort();
  assert.deepEqual(owners, ['.KU_chip', '.KU_rowv', '.K_end > span']);
  assert.match(css, /@media \(max-width: 340px\) \{ #K_glance, \.KU_tiles \{ grid-template-columns: minmax\(0, 1fr\); \}/);
});

test('s128 bills card: the two figures are centred, an unpaid row is a grid with the small line under name and amount, and the tile goes at 340 px and under', () => {
  const css = read('styles.css');
  assert.ok(css.includes('#T_bills .K_two > div { display: flex; flex-direction: column; align-items: center;'));
  assert.ok(css.includes('grid-template-areas: "tile name amt btn" "tile sub sub btn"'));
  assert.ok(css.includes('@media (max-width: 340px) { #T_bills .BL_tile { display: none; } }'));
  assert.ok(!css.includes('margin-top: -8px'));
});
