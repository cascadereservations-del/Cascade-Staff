// s113 (Staff 3.4.28). Lloyd 2026-11-08 on live 3.4.27: "i dont understand this visualization and graphs shown. improve and overhaul it"; the Phone check sheet was
// translucent; make Phone check a permanent Settings feature; and (orchestrator item) the guest tier guide: badges open it, a progress line, one place for the thresholds.
// Hand-computed expectations throughout. Contract: docs/s113/contract.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { read, root, boot, baseHandlers, HOMEWITH, stayRow, el, CS } from './_a_harness.mjs';

const tick = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const lib = () => { const w = { ICON: () => '' }; w.window = w; vm.runInContext(read('kpi/K_kpi.js'), vm.createContext(w)); return w.K_Kpi.lib; };
const MONTHS = ['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
// the live shape: one outlier month (March 233.5 kWh per stay), one empty month (February); September 11.25 kWh a day, so October's 9.9 is 12% lower
const KWH = [28, 28.6, 58, null, 233.5, 62.6, 37.7, 27, 24.9, 29.2, 30, 15.8];
const perMonth = () => MONTHS.map((m, i) => ({ month: m, stays: KWH[i] == null ? 0 : 4, kwh: KWH[i] == null ? null : KWH[i] * 4, m3: 2, kwh_per_stay: KWH[i], m3_per_stay: KWH[i] == null ? null : 0.5, kwh_per_day: m === '2026-09' ? 11.25 : 9, m3_per_day: m === '2026-09' ? 0.4 : 0.3 }));
const DAY = [10, 10, 10, 10, 8, 9, 42, 8.3]; // the highest (42) sits right beside the latest (8.3)
const perStay = () => DAY.map((v, i) => ({ checkout_date: '2026-10-' + String(20 + i).padStart(2, '0'), recorded_at: '2026-10-' + String(20 + i).padStart(2, '0') + 'T04:00:00Z', days: 3, kwh: v * 3, kwh_per_day: v, m3: 0.9, m3_per_day: 0.3 }));
const UTIL = (u) => Object.assign({ kwh_month: 79, kwh_per_day: 9.9, m3_month: 3.1, m3_per_day: 0.39, nights_booked: 12, nights_in_month: 30,
  last_reading: { recorded_at: '2026-11-05T02:00:00Z', delta_kwh: 25, days: 3, kwh_per_day: 8.3, delta_m3: 0.57, m3_per_day: 0.19, flag: null },
  per_stay: perStay(), per_month: perMonth(), brownouts: { count: 0, hours: 0 }, water_cuts: { count: 0, hours: 0 } }, u || {});
const payload = (u) => ({ ok: true, month: '2026-10-01', utility: UTIL(u), inventory: {} });
function mountWith(data, role = 'cleaner') {
  const win = { ICON: () => '', document: {} }; win.window = win; vm.runInContext(read('kpi/K_kpi.js'), vm.createContext(win));
  const L = {}, el0 = { innerHTML: '', addEventListener: (t, f) => { (L[t] ||= []).push(f); }, removeEventListener() {}, querySelector: () => null };
  win.K_Kpi.reset(); win.K_Kpi.mount(el0, { client: { rpc: (n) => Promise.resolve(n === 'kpi_tab_v1' ? { data, error: null } : { data: [], error: null }) }, role, propertyId: 'p' });
  const click = async (attrs) => { const t = { getAttribute: (n) => attrs[n] ?? null, closest: () => t }; for (const f of L.click || []) f({ target: t, preventDefault() {} }); await tick(); };
  return { el: el0, click };
}
const cardOf = (h, id) => { const i = h.indexOf('id="' + id + '"'); assert.ok(i > 0, id + ' is drawn'); const rest = h.slice(i); const j = rest.indexOf('<div class="card glass', 10); return j > 0 ? rest.slice(0, j) : rest; };
const tops = (c, cls) => [...c.matchAll(new RegExp('<span class="' + cls + '[^"]*" style="left:([\\d.]+)%;top:([\\d.]+)%"', 'g'))].map((m) => [+m[1], +m[2]]);

// ---------------------------------------------------------------------------------------------- scales
test('s113 scales: niceMax is the first 1, 2, 2.5 or 5 x 10^n at or above the value; 3-4 round gridlines between 0 and the top; percentile and median interpolate', () => {
  const K = lib();
  for (const [v, want] of [[0.7, 1], [1, 1], [1.2, 2], [2.2, 2.5], [3, 5], [8.3, 10], [13.3, 20], [24, 25], [42, 50], [60, 100], [84.42, 100], [233.5, 250], [0, 1], [-3, 1], [NaN, 1]]) assert.equal(K.niceMax(v), want, String(v));
  for (const [m, want] of [[1, [0, 0.25, 0.5, 0.75, 1]], [20, [0, 5, 10, 15, 20]], [25, [0, 5, 10, 15, 20, 25]], [50, [0, 10, 20, 30, 40, 50]], [100, [0, 25, 50, 75, 100]]]) assert.deepEqual([...K.ticksFor(m)], want, String(m));
  assert.equal(K.percentile([1, 2, 3, 4], 0.25), 1.75); assert.equal(K.percentile([4, null, 1, 3, 2], 0.75), 3.25, 'nulls skipped, sorted'); assert.equal(K.median([5, 1, 3]), 3); assert.equal(K.median([]), null);
  assert.deepEqual([...K.xPick(8)], [0, 2, 5, 7]); assert.deepEqual([...K.xPick(2)], [0, 1]); assert.deepEqual([...K.xPick(1)], [0]);
  assert.deepEqual({ ...K.change(9.9, 11.25) }, { dir: 'down', pct: 12 }); assert.deepEqual({ ...K.change(0.39, 0.4) }, { dir: 'same', pct: 0 }); assert.deepEqual({ ...K.change(12, 10) }, { dir: 'up', pct: 20 }); assert.equal(K.change(5, null), null);
  assert.equal(K.prevMonth('2026-01-01'), '2025-12'); assert.equal(K.prevMonth('2026-10'), '2026-09');
});

// ---------------------------------------------------------------------------------------------- geometry: the hanging bars cannot come back
test('s113 geometry: every value v sits at y = plotBottom - v / max * plotHeight, 0 on the baseline, the largest at or under the top; the drawn dots match the model', async () => {
  const K = lib(), m = K.dayModel(DAY);
  assert.equal(m.max, 50); assert.deepEqual({ ...K.PLOT }, { top: 0, bottom: 100, height: 100, pad: 4 });
  m.pts.forEach((p) => assert.equal(p.y, Math.round((K.PLOT.bottom - p.v / m.max * K.PLOT.height) * 100) / 100, 'value ' + p.v));
  assert.equal(K.yOf(0, 50), 100, 'zero is the bottom of the plot'); assert.equal(K.yOf(50, 50), 0, 'the top is the top');
  assert.ok(m.pts[6].y < m.pts[7].y, '42 is drawn higher than 8.3 (up means more)');
  const { el } = mountWith(payload()); await tick(); const c = cardOf(el.innerHTML, 'K_day');
  assert.deepEqual(tops(c, 'KU_pt').map((x) => x[1]), m.pts.map((p) => p.y), 'each dot is placed at its model y');
  const y0 = [...c.matchAll(/<line class="KU_base" x1="0" x2="100" y1="([\d.]+)"/g)].map((x) => +x[1]); assert.deepEqual(y0, [100], 'the baseline (0) is at the bottom');
  const ys = [...c.matchAll(/<span style="top:([\d.]+)%">([\d.]+)<\/span>/g)].map((x) => [+x[1], +x[2]]); assert.deepEqual(ys, [[100, 0], [80, 10], [60, 20], [40, 30], [20, 40], [0, 50]], 'y labels agree with the plot: 0 at the bottom, 50 at the top');
  // the root cause: .K_bar was also the booking calendar's bar (align-self: start, min-height 2rem). The chart uses KU_ classes, defined in K_kpi.css only.
  assert.match(read('calendar/K_bookcal.css'), /\.K_bar \{ align-self: start;/); assert.doesNotMatch(read('kpi/K_kpi.js'), /class="K_(bar|cols?|avgl|avgk)\b/);
  for (const f of ['styles.css', 'calendar/K_bookcal.css', 'tokens.css', 'stock/S110_supply.css'].filter((f) => fs.existsSync(path.join(root, f)))) assert.doesNotMatch(read(f), /\.KU_/, f + ' never styles a chart class');
});

// ---------------------------------------------------------------------------------------------- B: use per day
test('s113 chart B: Use per day, last 8 readings, a line with an area, a usual band (middle half), labels on the latest and the highest only, 4 short x labels, no average line', async () => {
  const { el, click } = mountWith(payload()); await tick();
  let c = cardOf(el.innerHTML, 'K_day');
  assert.match(c, /<b>Use per day, last 8 readings, kWh<\/b>/); assert.match(c, /data-kact="day" data-day="kwh" aria-selected="true">Electricity/);
  assert.match(c, /<svg class="KU_svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">/); assert.match(c, /<polyline class="KU_line" points="4,80 /); assert.match(c, /<path class="KU_area" d="M4,100 L4,80 /);
  // sorted 8, 8.3, 9, 10, 10, 10, 10, 42: 25th = 8.3 + 0.7 x 0.75 = 8.825, 75th = 10 -> band from y 80 to y 82.35
  assert.match(c, /<rect class="KU_band" vector-effect="non-scaling-stroke" x="0" width="100" y="80" height="2.35"><\/rect>/); assert.match(c, /<i class="KU_kband"><\/i>usual 8\.8 to 10 kWh/);
  assert.doesNotMatch(c, /avg|average|KU_typ/i, 'no average line: one outlier moves an average');
  assert.equal((c.match(/role="img"/g) || []).length, 8, 'a dot with an aria-label for every reading');
  assert.match(c, /aria-label="27 Oct: 8\.3 kWh a day over 3 days, latest reading"/); assert.match(c, /aria-label="26 Oct: 42 kWh a day over 3 days, highest"/);
  const vals = [...c.matchAll(/<span class="KU_val([^"]*)"[^>]*>([^<]+)<\/span>/g)].map((x) => [x[1].trim(), x[2]]);
  assert.deepEqual(vals, [['KU_val-em KU_val-r', '8.3'], ['KU_val-r', '42']], 'two values: the latest and the highest');
  const xs = [...c.matchAll(/<span class="KU_x([^"]*)" style="left:[\d.]+%">([^<]+)<\/span>/g)].map((x) => x[2]); assert.deepEqual(xs, ['20 Oct', '22 Oct', '25 Oct', '27 Oct'], 'first, last, two between');
  assert.match(c, /<p class="K_cap">Each point is the use since the previous reading, divided by the days in between\. The shaded band is the usual range\.<\/p>/);
  assert.match(c, /role="group" aria-label="Electricity per day, last 8 readings, kWh\. Latest 8\.3 on 27 Oct\. Usual range 8\.8 to 10\."/);
  await click({ 'data-kact': 'day', 'data-day': 'm3' }); c = cardOf(el.innerHTML, 'K_day');
  assert.match(c, /<b>Use per day, last 8 readings, m³<\/b>/); assert.match(c, /aria-label="27 Oct: 0\.3 m³ a day over 3 days, latest reading"/);
  const css = read('kpi/K_kpi.css'); assert.match(css, /\.KU_x \{[^}]*width: max-content;/, 'x labels never break across lines (no nowrap needed)'); assert.match(css, /\.KU_val \{[^}]*width: max-content;/);
});

// ---------------------------------------------------------------------------------------------- C: 12 months with an outlier
test('s113 chart C: one outlier month is drawn at the top edge with its true value and named; typical = median; months every 3rd, the current one bold; a gap stays a gap', async () => {
  const K = lib(), m = K.monthModel(KWH, 11);
  // 85th percentile of the 11 values = 58 + 4.6 x 0.5 = 60.3; x 1.4 = 84.42 -> 100; March 233.5 is over; median = 29.2
  assert.equal(m.max, 100); assert.deepEqual([...m.overs], [4]); assert.equal(m.pts[4].y, 0, 'at the top edge'); assert.equal(m.typical.v, 29.2); assert.equal(m.pts[3].y, null, 'February has no reading');
  assert.deepEqual(JSON.parse(JSON.stringify(m.segs.map((s) => s.length))), [3, 8], 'the line breaks at the gap');
  const { el, click } = mountWith(payload()); await tick(); let c = cardOf(el.innerHTML, 'K_avg');
  assert.match(c, /<b>Average per stay, last 12 months, kWh<\/b>/);
  assert.match(c, /<span class="KU_pt KU_pt-over" style="left:[\d.]+%;top:0%" role="img" aria-label="Mar 2026: 233\.5 kWh per stay, 4 stays, unusually high"><\/span>/);
  assert.match(c, /<span class="KU_val[^"]*"[^>]*>↑ 233\.5<\/span>/); assert.match(c, /233\.5 kWh in March: unusually high, check that month’s readings\./);
  assert.match(c, /<line class="KU_typ" x1="0" x2="100" y1="70\.8"/); assert.match(c, /<i class="KU_ktyp"><\/i>typical 29\.2 kWh/);
  const xs = [...c.matchAll(/<span class="KU_x([^"]*)" style="left:[\d.]+%">([^<]+)<\/span>/g)].map((x) => [x[2], /KU_xem/.test(x[1])]);
  assert.deepEqual(xs, [['Jan', false], ['Apr', false], ['Jul', false], ['Oct', true]], 'every 3rd month ending on the current one, 3 letters, upright');
  assert.match(c, /class="KU_pt KU_pt-em" style="left:96%;top:84\.2%" role="img" aria-label="Oct 2026: 15\.8 kWh per stay, 4 stays, this month"/);
  assert.equal((c.match(/role="img"/g) || []).length, 11, 'no dot for the empty month'); assert.match(c, /This month: 15\.8 kWh and 0\.5 m³ per stay over 4 stays\./);
  await click({ 'data-kact': 'avg', 'data-avg': 'm3' }); c = cardOf(el.innerHTML, 'K_avg'); assert.match(c, /<b>Average per stay, last 12 months, m³<\/b>/); assert.doesNotMatch(c, /KU_pt-over/);
});

// ---------------------------------------------------------------------------------------------- A, D: tiles and what this means
test('s113 tiles: big per-day numbers with units, context, a change chip in words vs last month, sparklines, the nights ring, the last reading; a plain What this means line', async () => {
  for (const role of ['cleaner', 'laundry', 'inspector', 'maintenance', 'owner']) {
    const { el } = mountWith(payload(), role); await tick(); const h = el.innerHTML;
    const e = cardOf(h, 'K_tE'); assert.match(e, /<span class="KU_chip KU_chip-down">down 12% vs September<\/span>/); assert.match(e, /<span class="KU_spark" role="img" aria-label="Electricity per day, last readings"><svg viewBox="0 0 100 100" preserveAspectRatio="none"/);
    assert.match(e, /<i style="left:96%;top:83\.4%"><\/i>/, 'the latest point is dotted');
    assert.match(cardOf(h, 'K_tW'), /<span class="KU_chip KU_chip-same">about the same as September<\/span>/);
    const n = cardOf(h, 'K_tN'); assert.match(n, /<circle class="KU_ring-f" cx="18" cy="18" r="15\.9155" stroke-dasharray="40 100" transform="rotate\(-90 18 18\)"><\/circle><\/svg><b>40%<\/b>/); assert.match(n, /12 of 30 nights/);
    assert.match(h, /<p class="KU_means" id="K_means"><b>What this means<\/b> Electricity is lower than last month\. Water is about the same as last month\.<\/p>/);
    assert.ok(h.indexOf('K_means') < h.indexOf('K_day') && h.indexOf('K_day') < h.indexOf('K_avg'), 'tiles, the line, then the two charts');
    assert.doesNotMatch(h, /₱|PHP|!/, role + ': no money, calm copy');
  }
  const none = mountWith(payload({ per_month: perMonth().filter((r) => r.month !== '2026-09') })); await tick();
  assert.doesNotMatch(none.el.innerHTML, /KU_chip|K_means/, 'no last month: no chip and no line, never a guess');
  const up = mountWith(payload({ kwh_per_day: 14 })); await tick(); assert.match(up.el.innerHTML, /KU_chip-up">up 24% vs September/); assert.match(up.el.innerHTML, /Electricity is higher than last month\./);
});

test('s113 tokens and house rules: chart tokens in all three theme blocks, no raw colours, no px type, gaps on the scale, the old bar CSS is gone', () => {
  const tok = read('tokens.css'); for (const k of ['chart-line', 'chart-area', 'chart-band', 'chart-grid', 'chart-axis', 'chart-avg']) assert.equal((tok.match(new RegExp('--v5-' + k + ':', 'g')) || []).length, 3, k);
  assert.doesNotMatch(tok, /--v5-chart-bar/, 'the bar tokens went with the bars');
  const css = read('kpi/K_kpi.css'); assert.doesNotMatch(css, /\.K_(bar|cols?|avgl|avgk|plot|yax|xax)\s*[{,>]|writing-mode/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgba?\(|nowrap|font(-size)?\s*:[^;}]*\d+px/i);
  for (const m of css.matchAll(/(?:^|[;{\s])gap\s*:\s*([^;}]+)/g)) for (const v of m[1].trim().split(/\s+/)) assert.ok(['0', '4px', '8px', '12px', '16px', '24px'].includes(v), 'gap ' + v);
  const s = read('styles.css'), blk = s.slice(s.indexOf('/* s113 Phone check')); assert.doesNotMatch(blk, /#[0-9a-f]{3,8}\b|rgba?\(|nowrap|font(-size)?\s*:[^;}]*\d+px/i);
  for (const m of blk.matchAll(/(?:^|[;{\s])gap\s*:\s*([^;}]+)/g)) for (const v of m[1].trim().split(/\s+/)) assert.ok(['0', '4px', '8px', '12px', '16px', '24px'].includes(v), 'styles gap ' + v);
  const d = (() => { const src = read('demo.js'); const mm = /function kpiFixture\(r, today\) \{[\s\S]*?\n  \}\n/.exec(src); return new Function('CS', mm[0] + '; return kpiFixture;')(CS)('owner', '2026-10-15'); })();
  const vals = d.utility.per_month.map((r) => r.kwh_per_stay).filter((v) => v != null); assert.ok(Math.max(...vals) > lib().percentile(vals, 0.85) * 1.4, 'the demo has one outlier month');
});

// ---------------------------------------------------------------------------------------------- Phone check: opaque, and in Settings
const lsWith = (o) => { const m = Object.assign({}, o); return { m, getItem: (k) => (k in m ? m[k] : k === 'cs_seen_v3' ? '1' : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } }; };
test('s113 phone check sheet: an opaque surface, no glass class, no blur, ink tokens on the rows', async () => {
  const app = await boot({ role: 'cleaner', hash: '#more', handlers: baseHandlers('cleaner') }); await app.click({ 'data-act': 'pc-open' }); await app.flush();
  const h = app.els['pc-sheet'].innerHTML; assert.match(h, /^<div class="PC_card card"><h2/); assert.doesNotMatch(h, /glass/);
  const css = read('styles.css'); assert.match(css, /\.sheet\.calsheet, \.sheet\.A_formsheet, \.PC_sheet \.PC_card \{ background: var\(--v5-surf\); -webkit-backdrop-filter: none; backdrop-filter: none; \}/);
  assert.match(css, /\.PC_sheet \.PC_mid > b \{ color: var\(--v5-ink\); \} \.PC_sheet \.PC_mid > \.sub \{ color: var\(--v5-ink-2\); \}/);
});
test('s113 Settings: a Phone check row for every role with the last result, and a Guest tiers guide row', async () => {
  assert.equal(CS.phoneCheckSummary(null), 'Not checked on this phone yet'); assert.equal(CS.phoneCheckSummary(lsWith({ cs_phone_check: JSON.stringify({ v: 1, need: 0, open: [] }) })), 'All good');
  assert.equal(CS.phoneCheckSummary(lsWith({ cs_phone_check: JSON.stringify({ v: 1, need: 2, open: ['storage'] }) })), '2 need a tap'); assert.equal(CS.phoneCheckSummary(lsWith({ cs_phone_check: JSON.stringify({ v: 1, open: ['storage'] }) })), '1 needs a tap', 'an older save counts its open rows');
  assert.equal(CS.phoneCheckSummary(lsWith({ cs_phone_check: '{bad' })), 'Not checked on this phone yet');
  const ls = lsWith(); CS.phoneCheckSave(ls, CS.phoneCheckRows({ alerts: { support: 'ready', permission: 'default' }, install: { standalone: true }, camera: { has: true, perm: 'granted' }, storage: { api: true, persisted: true }, update: { sw: true, controller: true, waiting: false, cacheOk: true }, trusted: false }));
  assert.equal(JSON.parse(ls.m.cs_phone_check).need, 2, 'alerts and trust need a tap'); assert.equal(CS.phoneCheckSummary(ls), '2 need a tap');
  for (const role of ['cleaner', 'inspector', 'maintenance', 'laundry', 'finance', 'owner']) {
    const h = (await boot({ role, hash: '#more', ls: lsWith({ cs_phone_check: JSON.stringify({ v: 1, need: 0, open: [] }) }), handlers: baseHandlers(role) })).els['v-more'].innerHTML;
    assert.match(h, /<div class="A_label">Settings<\/div><nav class="card glass list" aria-label="Settings"><button class="rowi" type="button" data-act="pc-open" id="H_pcrow">[\s\S]*?<span class="t">Phone check<\/span><span class="s">Alerts, camera, storage, updates · All good<\/span>/, role);
    assert.match(h, /data-act="tiers-open" data-tier="">[\s\S]*?<span class="t">Guest tiers guide<\/span>/, role); assert.match(h, /This phone<\/div>[\s\S]*Check this phone/, role + ': the This phone entry stays');
  }
});

// ---------------------------------------------------------------------------------------------- the guest tier guide
const GUEST = (o) => Object.assign({ guest_name: 'Ana Reyes', checkin_date: '2026-10-13', checkout_date: '2026-10-17', checkout_time: '12:00', checkin_time: '14:00', nights: 4, repeat: true, stay_count: 3, tier: 'returning', tier_line: null, notes: null, id_photo_path: null }, o || {});
test('s113 tier rules: one place (CS.TIER_RULES), the boundaries by stays and by nights, the progress line in plain words', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(CS.TIER_RULES)), { returning: { stays: 2 }, regular: { stays: 4, nights: 10 }, vip: { stays: 7, nights: 20 } });
  for (const [s, t] of [[1, 'first'], [2, 'returning'], [3, 'returning'], [4, 'regular'], [6, 'regular'], [7, 'vip']]) assert.equal(CS.tierFromCounts(s), t, s + ' stays');
  assert.equal(CS.tierFromCounts(2, 9), 'returning'); assert.equal(CS.tierFromCounts(2, 10), 'regular'); assert.equal(CS.tierFromCounts(5, 19), 'regular'); assert.equal(CS.tierFromCounts(5, 20), 'vip');
  const P = (s, n) => CS.tierProgress({ tier: CS.tierFromCounts(s, n), stay_count: s, total_nights: n });
  assert.equal(P(1), 'Returning from the 2nd stay'); assert.equal(P(2), '2 more stays to Regular (4 stays or 10 nights)'); assert.equal(P(3), '1 more stay to Regular (4 stays or 10 nights)');
  assert.equal(P(4), '3 more stays to VIP (7 stays or 20 nights)'); assert.equal(P(6), '1 more stay to VIP (7 stays or 20 nights)'); assert.equal(P(7), 'Top tier');
  assert.equal(P(2, 9), '2 more stays or 1 more night to Regular (4 stays or 10 nights)'); assert.equal(P(5, 19), '2 more stays or 1 more night to VIP (7 stays or 20 nights)');
  assert.equal(CS.tierProgress({ tier: 'vip' }), 'Top tier'); assert.equal(CS.tierProgress(null), null); assert.equal(CS.tierProgress({ tier: 'returning', repeat: true }), 'Next: Regular (4 stays or 10 nights)', 'no stay count: never guess how many are left'); assert.equal(CS.tierProgress({ tier: 'gold' }), null);
  assert.deepEqual(CS.tierGuide().map((t) => [t.tier, t.when, t.rule]), [['first', '1st stay', '1st stay. The standard amenities.'], ['returning', 'from the 2nd stay', 'From the 2nd stay.'], ['regular', '4 stays or 10 nights', '4 or more stays, or 10 or more nights.'], ['vip', '7 stays or 20 nights', '7 or more stays, or 20 or more nights.']]);
  assert.doesNotMatch(read('app.js'), /[^.]\b(?:4 or more stays|7 or more stays|10 or more nights)/, 'no copy of the thresholds in the shell');
});
test('s113 tier badges: on the Now and Up next cards (and the Calendar guest card) a button opens the guide on that tier, focus on its row; the progress line sits under the badge', async () => {
  const cur = GUEST({ tier: 'vip', stay_count: 8 }), nxt = GUEST({ guest_name: 'Ben Cruz', checkin_date: '2026-10-17', checkout_date: '2026-10-19', tier: 'returning', repeat: true, stay_count: 2 });
  let focused = ''; const rowEl = (t) => Object.assign(el(), { focus() { focused = t; } });
  const app = await boot({ role: 'cleaner', hash: '#home', els: { 'tg-vip': rowEl('vip'), 'tg-returning': rowEl('returning') }, handlers: baseHandlers('cleaner', { staff_home_v1: () => HOMEWITH([stayRow('Ana Reyes', '2026-10-13', '2026-10-17')], { current_guest: cur, next_guest: nxt }) }) });
  const h = app.els['v-home'].innerHTML;
  assert.match(h, /<button class="T_ribbon p-tier-vip" type="button" data-act="tiers-open" data-tier="vip"><svg[^>]*><\/svg><span>VIP · 8 stays<\/span><span class="sr">, open the guest tiers guide<\/span><\/button><p class="sub T_prog">Top tier<\/p>/);
  assert.match(h, /T_upnext[\s\S]*?<button class="T_badge p-tier-returning" type="button" data-act="tiers-open" data-tier="returning">[\s\S]*?<\/button><\/div><p class="sub T_prog">2 more stays to Regular \(4 stays or 10 nights\)<\/p>/);
  await app.click({ 'data-act': 'tiers-open', 'data-tier': 'vip' }); await app.flush();
  const b = app.els['cs-body'].innerHTML; assert.equal(app.els['cal-sheet'].getAttribute('aria-hidden'), 'false'); assert.equal(focused, 'vip', 'focus on the guest’s own tier row');
  assert.match(b, /<h2 class="ttl" id="cs-h" tabindex="-1">Guest tiers: how many stays for each<\/h2>/); assert.match(b, /<tr class="T_tr T_tcur" id="tg-vip" tabindex="-1" aria-current="true">/); assert.equal((b.match(/aria-current/g) || []).length, 1);
  assert.match(b, /<th scope="col">Tier<\/th><th scope="col">When<\/th><th scope="col">What they get<\/th>/); assert.match(b, /id="tg-regular"[\s\S]*?<td>4 stays or 10 nights<\/td>/); assert.doesNotMatch(b, /₱|!/);
  assert.match(read('styles.css'), /\.sheet\.calsheet, \.sheet\.A_formsheet/, 'the guide uses the opaque calendar sheet');
  await app.click({ 'data-act': 'tiers-open', 'data-tier': '<x>' }); await app.flush(); assert.doesNotMatch(app.els['cs-body'].innerHTML, /aria-current|&lt;x|<x>/, 'an unknown tier opens the plain guide');
  const cal = (await boot({ role: 'owner', hash: '#calendar/house', handlers: baseHandlers('owner', { staff_home_v1: () => HOMEWITH([stayRow('Ana Reyes', '2026-10-13', '2026-10-17')], { current_guest: GUEST({ tier: 'regular', stay_count: 5 }) }) }) })).els['v-calendar'].innerHTML;
  assert.match(cal, /<button class="T_badge p-tier-regular" type="button" data-act="tiers-open" data-tier="regular">/);
  const css = read('styles.css'); assert.match(css, /button\.T_ribbon, button\.T_badge \{[^}]*cursor: pointer;/); assert.match(css, /button\.T_badge::after \{ content: ""; position: absolute; inset: -8px -4px; \}/);
});
test('s113 Today guide card: "Guest tiers: how many stays for each", open the first time on this phone, closed once the person closes it (storage may fail), a compact table', async () => {
  const ls = lsWith(); const app = await boot({ role: 'laundry', hash: '#home', ls, handlers: baseHandlers('laundry') });
  const h = app.els['v-home'].innerHTML, m = /<details class="card glass A_card F_span T_tiers" id="T_tiers" open>[\s\S]*?<\/details>/.exec(h); assert.ok(m, 'open the first time');
  assert.match(m[0], /<span>Guest tiers: how many stays for each<\/span>/); assert.match(m[0], /<table class="T_ttab">/); assert.equal((m[0].match(/<tr class="T_tr"/g) || []).length, 4);
  assert.match(m[0], /<span class="T_badge p-tier-vip"><svg[^>]*><\/svg><span>VIP<\/span><\/span><\/th><td>7 stays or 20 nights<\/td><td><ul class="T_tperks">[\s\S]*Handwritten welcome note[\s\S]*Mid-stay refresh/, 'arrival and house perks together');
  assert.match(m[0], /<td>1st stay<\/td><td>The standard amenities<\/td>/);
  for (const f of app.listeners.toggle) f({ target: { classList: { contains: (c) => c === 'T_tiers' }, open: false } });
  assert.equal(ls.m.cs_tiers_seen, '1', 'closing it is remembered on this phone');
  const again = (await boot({ role: 'laundry', hash: '#home', ls, handlers: baseHandlers('laundry') })).els['v-home'].innerHTML; assert.match(again, /id="T_tiers"><summary/, 'closed from then on');
  const broken = { getItem: (k) => { if (k === 'cs_tiers_seen') throw new Error('denied'); return k === 'cs_seen_v3' ? '1' : null; }, setItem: () => { throw new Error('denied'); }, removeItem() {} };
  const b = await boot({ role: 'cleaner', hash: '#home', ls: broken, handlers: baseHandlers('cleaner') }); assert.match(b.els['v-home'].innerHTML, /id="T_tiers" open>/, 'no storage: it opens, nothing throws');
  for (const f of b.listeners.toggle) f({ target: { classList: { contains: (c) => c === 'T_tiers' }, open: false } });
});

// ---------------------------------------------------------------------------------------------- release
test('s113 release: 3.4.28, cs-shell-v53 in sw.js and PC_SHELL, the new test file is the contract name', () => {
  assert.equal(JSON.parse(read('package.json')).version, '3.4.28'); assert.match(read('app.js'), /version: '3\.4\.28'/);
  assert.match(read('sw.js'), /CACHE_NAME = 'cs-shell-v53'/); assert.match(read('app.js'), /var PC_SHELL = 'cs-shell-v53';/);
});
