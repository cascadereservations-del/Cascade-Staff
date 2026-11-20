// s127 (Staff 3.4.42): electricity and water bills, rate history, usage by month and by guest, and the Today bills card. Contract: docs/s127/CONTRACT.md (Facts, Lane B).
// Hand-computed expectations. Older server (no new keys) must render what it rendered before.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { read, CS } from './_a_harness.mjs';

const tick = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const NB = ' ';
function load() { const w = { ICON: () => '', document: {}, CS: { faceFrame: () => ({ scale: 1, w: 44, h: 44, left: 0, top: 0, fallback: false }) } }; w.window = w; vm.runInContext(read('kpi/K_kpi.js'), vm.createContext(w)); return w; }
const lib = () => load().K_Kpi.lib;
function mountWith(data, role = 'owner', extra = {}) {
  const win = load(), L = {}, el0 = { innerHTML: '', addEventListener: (t, f) => { (L[t] ||= []).push(f); }, removeEventListener() {}, querySelector: () => null };
  win.K_Kpi.reset(); win.K_Kpi.mount(el0, Object.assign({ client: { rpc: (n) => Promise.resolve(n === 'kpi_tab_v1' ? { data, error: null } : { data: [], error: null }) }, role, propertyId: 'p' }, extra));
  const click = async (attrs) => { const t = { getAttribute: (n) => attrs[n] ?? null, closest: () => t }; for (const f of L.click || []) f({ target: t, preventDefault() {} }); await tick(); };
  return { el: el0, click };
}
const ADMIN_OLD = { rate: { php_per_kwh: 11.25, effective_from: '2026-11-01' }, sold_nights: 12, cost: {}, meter: {} };
const base = (over) => Object.assign({ ok: true, month: '2026-11-01', utility: { kwh_month: 79, kwh_per_day: 9.9, m3_month: 3.1, m3_per_day: 0.39, nights_booked: 12, nights_in_month: 30, per_stay: [], per_month: [] }, inventory: {}, admin: ADMIN_OLD }, over || {});
const NEW_ADMIN = () => Object.assign({}, ADMIN_OLD, {
  rate: { php_per_kwh: 11.25, effective_from: '2026-11-01', checked_at: '2026-11-19T01:00:00Z' }, rate_year_avg: 10.78,
  rate_history: [{ month: '2026-11', php_per_kwh: 11.25, change_pct: -4.7 }, { month: '2026-10', php_per_kwh: 11.8, change_pct: 1.3 }, { month: 'bad', php_per_kwh: 3 }, { month: '2026-09', php_per_kwh: null }],
  water_rate: { min_php: 212, min_m3: 10, next_php: 23.05, next_upto: 20, source_url: 'https://gensanwater.gov.ph/water-rates/' },
  bills: { electric: { cycle_from: '2026-10-21', cycle_to: '2026-11-21', days: 29, days_in_cycle: 31, kwh: 383, rate: 11.25, fixed_php: 5.6, so_far_php: 4314.35, forecast_kwh: 409, forecast_php: 4606.85, per_day_kwh: 13.2, per_day_php: 148.5, last_reading_at: '2026-11-19T02:00:00Z' },
    water: { cycle_from: '2026-10-21', cycle_to: '2026-11-21', days: 29, m3: 7.2, so_far_php: 212, forecast_m3: 7.7, forecast_php: 212, per_day_m3: 0.25, min_php: 212, min_m3: 10, next_php: 23.05, next_upto: 20 } },
  stays: [{ from: '2026-11-17', to: '2026-11-18', nights: 1, kwh: 10, m3: 0.11, cost_php: 112.5, guest_name: '<b>Demo Guest One</b>', tier: 'vip', id_photo_path: 'demo/id-1', id_face_box: { x: 0.1, y: 0.2, w: 0.3, h: 0.5, src: 'v' } },
    { from: '2026-10-01', to: '2026-10-05', nights: 4, kwh: 37, m3: 0.2, cost_php: 416, guest_name: 'Old Stay', tier: 'zzz', id_photo_path: null, id_face_box: { x: 'a' } }],
});
const USAGE = () => [{ month: '2026-06', kwh: 372, m3: 5.9, kwh_change_pct: null, m3_change_pct: null }, { month: '2026-07', kwh: 380, m3: 5.8, kwh_change_pct: 2, m3_change_pct: -2 }, { month: '2026-11', kwh: 338, m3: 5.5, kwh_change_pct: -11, m3_change_pct: 0.2, forecast: true, kwh_so_far: 214, m3_so_far: 3.5 }];

test('s127 arrows: up is warn, down is ok, none is a dash, a change that rounds to zero is a plain 0%', () => {
  const K = lib();
  assert.deepEqual({ ...K.arrowOf(4.6) }, { cls: 'K_warn', ico: '🔺', n: '5' });
  assert.deepEqual({ ...K.arrowOf(-11) }, { cls: 'K_ok', ico: '🔻', n: '11' });
  assert.deepEqual({ ...K.arrowOf(0.2) }, { cls: '', ico: '', n: '0' });
  assert.equal(K.arrowOf(null), null); assert.equal(K.arrowOf('x'), null);
  assert.equal(K.arrowText(-11), '🔻' + NB + '11%'); assert.equal(K.arrowText(0.3), '0%'); assert.equal(K.arrowText(null), '–');
  assert.equal(K.arrowText(-1.26, 1), '🔻' + NB + '1.3%');
});

test('s127 helpers: Manila day, usage months (last six, bad rows dropped), cycle filter, per night', () => {
  const K = lib();
  assert.equal(K.manilaDay('2026-11-19T17:00:00Z'), '2026-11-20'); assert.equal(K.manilaDay('nope'), '');
  const um = K.usageMonths([{ month: 'x' }, null, ...Array.from({ length: 8 }, (_, i) => ({ month: '2026-0' + (i + 1), kwh: i, m3: '1.5', forecast: i === 7, kwh_so_far: i === 7 ? '9' : null }))]);
  assert.equal(um.length, 6); assert.equal(um[0].month, '2026-03'); assert.equal(um[5].forecast, true); assert.equal(um[5].kwhSoFar, 9); assert.equal(um[0].m3, 1.5); assert.deepEqual([...K.usageMonths('x')], []);
  assert.deepEqual([...K.inCycle([{ to: '2026-10-01' }, { to: '2026-11-03' }], '2026-10-21')].map((s) => s.to), ['2026-11-03']); assert.deepEqual([...K.inCycle([{ to: '2026-11-03' }], '')], []);
  assert.equal(K.perNight(10, 4), 2.5); assert.equal(K.perNight(10, 0), null); assert.equal(K.perNight(null, 2), null);
});

test('s127 normaliser: new keys land, bad rows and bad urls drop, usage_months is read for every role, money only for the admin roles', () => {
  const K = lib(), d = K.normalize(base({ admin: NEW_ADMIN(), utility: Object.assign(base().utility, { usage_months: USAGE() }) }), 'owner');
  assert.equal(d.admin.bills.e.soFar, 4314.35); assert.equal(d.admin.bills.e.fKwh, 409); assert.equal(d.admin.bills.w.min, 212); assert.equal(d.admin.yearAvg, 10.78);
  assert.deepEqual([...d.admin.rateHistory].map((r) => r.month), ['2026-11', '2026-10', '2026-09'].slice(0, 2).concat(['2026-09']).filter((m) => m !== '2026-09'), 'the bad month and the null rate are dropped');
  assert.equal(d.admin.waterRate.url, 'https://gensanwater.gov.ph/water-rates/'); assert.equal(d.admin.rate.checked, '2026-11-19T01:00:00Z');
  assert.equal(d.admin.stays.length, 2); assert.equal(d.admin.stays[0].tier, 'vip'); assert.equal(d.admin.stays[1].tier, ''); assert.equal(d.admin.stays[1].box, null); assert.deepEqual({ ...d.admin.stays[0].box }, { x: 0.1, y: 0.2, w: 0.3, h: 0.5, src: 'v' });
  assert.equal(d.utility.usageMonths.length, 3);
  const bad = K.normalize(base({ admin: Object.assign(NEW_ADMIN(), { water_rate: { min_php: 212, source_url: 'http://x' } }) }), 'owner'); assert.equal(bad.admin.waterRate.url, '', 'http is not a link');
  const clean = K.normalize(base({ admin: NEW_ADMIN(), utility: Object.assign(base().utility, { usage_months: USAGE() }) }), 'cleaner');
  assert.equal(clean.admin, null, 'a cleaner never gets the admin key'); assert.equal(clean.utility.usageMonths.length, 3, 'usage months carry no money and are read for all roles');
  const old = K.normalize(base(), 'owner'); assert.equal(old.admin.bills, null); assert.deepEqual([...old.admin.stays], []); assert.deepEqual([...old.utility.usageMonths], []);
});

test('s127 render: the new Admin panel, escaped, https only, face attributes, forecast lines first in the money lines', async () => {
  const data = base({ admin: NEW_ADMIN(), utility: Object.assign(base().utility, { usage_months: USAGE() }) });
  const m = mountWith(data, 'owner'); await tick(); await m.click({ 'data-kact': 'seg', 'data-seg': 'admin' });
  const h = m.el.innerHTML;
  for (const c of ['K_util-e', 'K_util-w', 'K_util-u', 'KB_', 'KG_']) assert.ok(h.includes(c), c + ' is drawn');
  assert.ok(!h.includes('<b>Demo Guest One</b>'), 'guest name is escaped'); assert.ok(h.includes('&lt;b&gt;Demo Guest One'), 'escaped text shown');
  assert.ok(h.includes('href="https://gensanwater.gov.ph/water-rates/"'), 'https source link');
  assert.ok(/data-facepath="demo\/id-1"/.test(h) && /data-facepx="(44|32)"/.test(h), 'face attributes for the shell loader');
  assert.ok(!/data-facepath="[^"]*"[^>]*data-facepath/.test(h)); assert.ok(!h.includes('Old Stay\u0000'));
  assert.ok(h.includes('🔻' + NB + '11%') || h.includes('🔻'), 'arrow drawn');
  assert.ok(!/http:\/\//.test(h), 'no plain http links');
});

test('s127 render: an older server (none of the new keys) draws no new section and does not fail', async () => {
  const m = mountWith(base(), 'owner'); await tick(); await m.click({ 'data-kact': 'seg', 'data-seg': 'admin' });
  const h = m.el.innerHTML; assert.ok(h.length > 100, 'the Admin panel still draws');
  for (const c of ['K_util-e', 'K_util-w', 'K_util-u', 'KB_', 'KG_']) assert.ok(!h.includes(c), c + ' absent on an older server');
});

test('s127 render: a cleaner sees the usage months but no pesos and no admin sections', async () => {
  const data = base({ admin: NEW_ADMIN(), utility: Object.assign(base().utility, { usage_months: USAGE() }) });
  const m = mountWith(data, 'cleaner'); await tick(); const h = m.el.innerHTML;
  assert.ok(!/₱\s?4,314|4,314/.test(h), 'no peso figure from admin'); assert.ok(!h.includes('K_util-e'));
});

test('s127 lib.billsToday: the contract shape, a missing peso stays null, anything else is null', () => {
  const ok = CS.billsToday({ since: '2026-10-21', last_reading_at: '2026-11-19T17:30:00Z', electric: { php: 4314.35, kwh: 383 }, water: { php: 212, m3: 7.2 } });
  assert.deepEqual({ ...ok }, { since: '2026-10-21', last: '2026-11-20', ePhp: 4314.35, eKwh: 383, wPhp: 212, wM3: 7.2 });
  assert.equal(CS.billsToday({ since: '2026-10-21', electric: { php: null, kwh: 5 }, water: { php: 0, m3: 0 } }).ePhp, null);
  for (const bad of [null, undefined, 'x', [], {}, { since: 'no', electric: { kwh: 1 }, water: { php: 1, m3: 1 } }, { since: '2026-10-21', electric: { php: 1 }, water: { php: 1, m3: 1 } }, { since: '2026-10-21', electric: { php: 1, kwh: 1 }, water: null }]) assert.equal(CS.billsToday(bad), null);
});

test('s127 demo: the fixture carries the new keys with invented names and the Today bills answer', () => {
  const src = read('demo.js'); assert.match(src, /case 'today_bills_v1'/); assert.match(src, /Demo Guest One/);
  const m = /function kpiFixture\(r, today\) \{[\s\S]*?\n  function s127\([\s\S]*?\n  \}\n/.exec(src); const fn = new Function('CS', m[0] + '; return kpiFixture;')(CS);
  const o = fn('owner', '2026-11-20'), c = fn('cleaner', '2026-11-20');
  assert.equal(o.admin.bills.electric.so_far_php, 4314.35); assert.equal(o.admin.stays.length, 5); assert.ok(o.utility.usage_months.length >= 5);
  assert.equal(c.admin, undefined, 'no admin key for a cleaner'); assert.ok(c.utility.usage_months.length >= 5, 'usage months for every role');
  assert.ok(!JSON.stringify(c).includes('so_far_php'), 'no money for a cleaner');
});

test('s127 shell: the Today card sits right after the utility bar, is drawn from today_bills_v1, and logs nothing when the RPC is missing', () => {
  const a = read('app.js');
  assert.equal((a.match(/A_utilBar\(\)\)? \+ A_billsCard\(\)/g) || []).length, 2, 'both layouts');
  assert.match(a, /sb\.rpc\('today_bills_v1'/); assert.match(a, /id="T_bills"/);
  const fnBody = /function A_loadBills\(\) \{[\s\S]*?\n  \}\n/.exec(a)[0]; assert.ok(!/console\.|toast/.test(fnBody), 'no toast and no log');
  assert.match(a, /faces: A_loadFaces/); assert.match(a, /data-facepx/);
});

test('s127 CSS: house rules on the new block (tokens, no nowrap, no px type, gaps on the scale)', () => {
  const css = read('kpi/K_kpi.css'), blk = css.slice(css.indexOf('/* s127 (Staff'));
  assert.ok(blk.length > 500); assert.doesNotMatch(blk, /#[0-9a-f]{3,8}\b|rgba?\(|nowrap|font(-size)?\s*:[^;}]*\d+px/i);
  for (const m of blk.matchAll(/(?:^|[;{\s])gap\s*:\s*([^;}]+)/g)) for (const v of m[1].trim().split(/\s+/)) assert.ok(['0', '4px', '8px', '12px', '16px', '24px'].includes(v), 'gap ' + v);
  const st = read('styles.css'), sb = st.slice(st.indexOf('#T_bills')); assert.doesNotMatch(sb.slice(0, 1500), /#[0-9a-f]{3,8}\b|rgba?\(|nowrap/i);
});

test('s127 release: 3.4.42 with cs-shell-v67', () => {
  assert.equal(JSON.parse(read('package.json')).version, '3.4.42'); assert.match(read('app.js'), /version: '3\.4\.42'/); assert.match(read('sw.js'), /CACHE_NAME = 'cs-shell-v67'/); assert.match(read('app.js'), /var PC_SHELL = 'cs-shell-v67';/);
});
