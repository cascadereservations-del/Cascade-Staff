// s127 (Staff 3.4.43): electricity and water bills, rate history, usage by month and by guest, and the Today bills card. Contract: docs/s127/CONTRACT.md (Facts, Lane B).
// Hand-computed expectations. Older server (no new keys) must render what it rendered before.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { read, CS, boot, baseHandlers, HOMEWITH } from './_a_harness.mjs';

const tick = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const NB = ' ';
const FRAME = { scale: 1, w: 44, h: 44, left: 0, top: 0, fallback: false };
function load(frame = FRAME) { const w = { ICON: () => '', document: {}, CS: { faceFrame: () => frame } }; w.window = w; vm.runInContext(read('kpi/K_kpi.js'), vm.createContext(w)); return w; }
const lib = () => load().K_Kpi.lib;
function mountWith(data, role = 'owner', extra = {}, frame) {
  const win = load(frame), L = {}, el0 = { innerHTML: '', addEventListener: (t, f) => { (L[t] ||= []).push(f); }, removeEventListener() {}, querySelector: () => null };
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
  assert.deepEqual([...d.admin.rateHistory].map((r) => r.month), ['2026-11', '2026-10'], 'the bad month and the null rate are dropped'); assert.equal(d.admin.rateHistory[0].pct, -4.7);
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
  assert.equal((h.match(/data-facepath=/g) || []).length, 2, 'two located faces (the stay with a path and a box; the old stay has no path), each once');
  assert.ok(h.includes('<i class="KB_a">🔻</i>11%'), 'the November electricity chip is a down arrow, 11%');
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
  assert.deepEqual({ ...ok }, { since: '2026-10-21', last: '2026-11-20', ePhp: 4314.35, eKwh: 383, wPhp: 212, wM3: 7.2, due: [] });
  assert.equal(CS.billsToday({ since: '2026-10-21', electric: { php: null, kwh: 5 }, water: { php: 0, m3: 0 } }).ePhp, null);
  for (const bad of [null, undefined, 'x', [], {}, { since: 'no', electric: { kwh: 1 }, water: { php: 1, m3: 1 } }, { since: '2026-10-21', electric: { php: 1 }, water: { php: 1, m3: 1 } }, { since: '2026-10-21', electric: { php: 1, kwh: 1 }, water: null }]) assert.equal(CS.billsToday(bad), null);
});

test('s127 demo: the fixture carries the new keys with invented names and the Today bills answer', () => {
  const src = read('demo.js'); assert.match(src, /case 'today_bills_v1'/); assert.match(src, /Demo Guest One/);
  const m = /function kpiFixture\(r, today\) \{[\s\S]*?\n  function s127\([\s\S]*?\n  \}\n/.exec(src); const fn = new Function('CS', m[0] + '; return kpiFixture;')(CS);
  const o = fn('owner', '2026-11-20'), c = fn('cleaner', '2026-11-20');
  assert.equal(o.admin.bills.electric.so_far_php, 4314.35); assert.equal(o.admin.stays.length, 5); assert.ok(o.utility.usage_months.length >= 5);
  const lm = o.utility.usage_months.at(-1), pm = o.utility.usage_months.at(-2), am = o.utility.usage_months.at(-4); // hand-computed: 214 kWh over 12 nights, 3.5 m3 over 12; October 380 over 22 and 8.9 over 22; the gap month has no nights
  assert.deepEqual([lm.guest_nights, lm.kwh_per_night, lm.m3_per_night, lm.kwh_night_change_pct, lm.m3_night_change_pct], [12, 17.8, 0.29, 3, -28]); assert.deepEqual([pm.kwh_per_night, pm.m3_per_night], [17.3, 0.4]); assert.deepEqual([am.guest_nights, am.kwh_per_night], [0, null]);
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
  assert.match(css, /\.K_util \.K_money \.K_lab \{ color: var\(--v5-panel-fg-2\); \}/, 'the label on the navy panel uses the panel light token, not the section colour'); assert.doesNotMatch(css, /\.K_money \.K_lab \{ color: var\(--ub\)/);
  const st = read('styles.css'), sb = st.slice(st.indexOf('#T_bills')); assert.doesNotMatch(sb.slice(0, 1500), /#[0-9a-f]{3,8}\b|rgba?\(|nowrap/i);
});

// ---- fix round 1 (Addendum 1 and 3)
const PN = () => [
  { month: '2026-09', kwh: 349, m3: 6.2, kwh_change_pct: 23, m3_change_pct: 5, guest_nights: 21, kwh_per_night: 16.6, m3_per_night: 0.3, kwh_night_change_pct: 23, m3_night_change_pct: 5 },
  { month: '2026-10', kwh: 380, m3: 8.9, kwh_change_pct: 4, m3_change_pct: 36, guest_nights: 22, kwh_per_night: 17.3, m3_per_night: 0.4, kwh_night_change_pct: -7, m3_night_change_pct: 36 },
  { month: '2026-11', kwh: 338, m3: 5.5, kwh_change_pct: -11, m3_change_pct: -38, forecast: true, kwh_so_far: 214, m3_so_far: 3.5, guest_nights: 12, kwh_per_night: 17.8, m3_per_night: null, kwh_night_change_pct: null, m3_night_change_pct: null }];
const adminWith = (usage, admin = NEW_ADMIN(), role = 'owner') => mountWith(base({ admin, utility: Object.assign(base().utility, { usage_months: usage }) }), role);
const openAdmin = async (m) => { await tick(); await m.click({ 'data-kact': 'seg', 'data-seg': 'admin' }); return m.el.innerHTML; };
const text = (h) => h.replace(/<[^>]*>/g, ' ');

test('s127 r1 per night: the small number sits under each month, the chip uses the per-night change else the month change, the captions are the mockup captions', async () => {
  const h = await openAdmin(adminWith(PN()));
  assert.equal((h.match(/<span class="KB_n">/g) || []).length, 6, 'three months, two charts');
  for (const n of ['16.6', '17.3', '17.8', '0.30', '0.40']) assert.ok(h.includes('<span class="KB_n">' + n + '</span>'), n);
  assert.ok(h.includes('<span class="KB_n">–</span>'), 'a null m3 per night is a dash, not 0.00');
  assert.ok(h.includes('KB_c K_ok"><i class="KB_a">🔻</i>7%'), 'October kWh uses the per-night change (-7), not the month change (+4)'); assert.ok(!h.includes('KB_c K_warn"><i class="KB_a">🔺</i>4%'));
  assert.ok(h.includes('KB_c K_ok"><i class="KB_a">🔻</i>11%'), 'November has no per-night change: the month change (-11) is used');
  assert.ok(h.includes('Small number: kWh per guest night. The arrow is its change from the month before, so a busy month does not look like waste. November is a forecast; the solid part is used so far.'));
  assert.ok(h.includes('Small number: m³ per guest night, with its change.'));
  assert.ok(h.includes('November forecast 338, 17.8 a night so far'), 'the screen-reader label carries the per-night figure');
  assert.ok(/K_big">214 kWh/.test(h), 'the hero keeps the month total so far');
});

test('s127 r1 per night: a server that sends no per-night keys draws the chart as before', async () => {
  const h = await openAdmin(adminWith(USAGE()));
  assert.ok(!h.includes('<span class="KB_n">'), 'no small number'); assert.ok(h.includes('The arrow is the change from the month before.')); assert.ok(!h.includes('Small number'));
  assert.ok(h.includes('KB_c K_ok"><i class="KB_a">🔻</i>11%'), 'the month change still drives the chip');
  const u = lib().usageMonths(PN()); assert.equal(u[1].kwhNightPct, -7); assert.equal(u[2].m3Night, null); assert.equal(u[1].nights, 22); assert.equal(lib().usageMonths(USAGE())[0].pn, false);
});

test('s127 r1 thousands: kWh and m3 from 1,000 are grouped on the KPI tab; small numbers keep their decimals', async () => {
  const K = lib(); assert.equal(K.fmtU(1234.4, 0), '1,234'); assert.equal(K.fmtU(1234.56, 1), '1,234.6'); assert.equal(K.fmtU(999.5, 0), '1,000'); assert.equal(K.fmtU(5.5, 1), '5.5'); assert.equal(K.nightTxt(1234.5, 1), '1,234.5'); assert.equal(K.nightTxt(0.4, 2), '0.40');
  const a = NEW_ADMIN(); a.bills.electric.kwh = 1383; a.bills.electric.forecast_kwh = 1409; a.bills.water.m3 = 1012.3; a.bills.water.forecast_m3 = 1100.5;
  const h = await openAdmin(adminWith([{ month: '2026-10', kwh: 1240, m3: 1012.3 }, { month: '2026-11', kwh: 1500, m3: 1100.5, forecast: true, kwh_so_far: 1200, m3_so_far: 1000 }], a)), t = text(h);
  for (const n of ['1,383', '1,409', '1,012.3', '1,100.5', '1,240', '1,500', '1,200']) assert.ok(h.includes(n), n + ' is grouped');
  assert.ok(!/\b1383\b|\b1409\b|\b1012\.3\b/.test(t), 'no ungrouped figure in the text');
});

test('s127 r1 face stack: "+N more stays" counts the real number, four or fewer say "N stays"', async () => {
  const st = (n) => Array.from({ length: n }, (_, i) => ({ from: '2026-11-0' + (i + 1), to: '2026-11-0' + (i + 2), nights: 1, kwh: 10, m3: 0.1, cost_php: 100, guest_name: 'Demo ' + i, tier: '', id_photo_path: null }));
  const stack = async (n) => { const a = NEW_ADMIN(); a.stays = st(n); return (await openAdmin(adminWith([], a))).match(/KG_stack[\s\S]*?<\/div>/)[0]; };
  const five = await stack(5); assert.ok(text(five).includes('+ more stays'), 'the server caps stays at 5, so no exact count is claimed'); assert.ok(!/\+\d/.test(text(five)));
  assert.ok(text(await stack(4)).includes('4 stays')); assert.ok(text(await stack(1)).includes('1 stay'));
});

test('s127 r1 null fields: a live-shape worst case draws dashes and reasons, never undefined, NaN or null', async () => {
  const a = { rate: null, sold_nights: null, cost: {}, meter: {}, rate_history: [{ month: '2026-11', php_per_kwh: 11, change_pct: null }, { month: '2026-10', php_per_kwh: 12, change_pct: -0.04 }], water_rate: { min_php: 212 },
    bills: { electric: { cycle_from: null, cycle_to: null, days: null, kwh: null, so_far_php: null, forecast_kwh: null, forecast_php: null, per_day_kwh: null }, water: { m3: null, so_far_php: null, forecast_m3: null, forecast_php: null } },
    stays: [{ from: null, to: '2026-11-18', nights: null, kwh: null, m3: null, cost_php: null, guest_name: null, tier: null, id_photo_path: null, id_face_box: null }] };
  const um = [{ month: '2026-10', kwh: null, m3: null, kwh_per_night: null, m3_per_night: null, kwh_night_change_pct: null }, { month: '2026-11', kwh: null, m3: null, forecast: true, kwh_so_far: null, m3_so_far: null }, { month: '2026-09', kwh: 0, m3: 0, kwh_per_night: 0, m3_per_night: 0 }];
  const h = await openAdmin(adminWith(um, a)), t = text(h);
  assert.ok(h.length > 500); assert.ok(h.includes('K_util-w') && h.includes('K_util-u'));
  assert.doesNotMatch(h, /undefined|NaN/); assert.doesNotMatch(t, /\bnull\b/);
  assert.ok(t.includes('Not yet'), 'a missing peso is "Not yet", not ₱0'); assert.ok(h.includes('<b>Guest</b>'), 'a missing name is "Guest"');
});

test('s127 r1 negative zero: a change that rounds to zero is a plain 0%, never -0 or a down arrow', async () => {
  const K = lib(); assert.equal(K.arrowText(-0.2, 0), '0%'); assert.equal(K.arrowText(-0.04, 1), '0%'); assert.equal(K.nightTxt(-0.004, 2), '0.00'); assert.equal(K.fmtU(-0.2, 0), '0'); assert.equal(K.arrowOf(-0.2).ico, '');
  const h = await openAdmin(adminWith([{ month: '2026-10', kwh: 380, m3: 5, kwh_change_pct: -0.2, kwh_per_night: 17, kwh_night_change_pct: -0.3, m3_per_night: 0.4, m3_night_change_pct: 0.1 }, { month: '2026-11', kwh: 380, m3: 5, kwh_change_pct: 0, kwh_per_night: 17, m3_per_night: 0.4, kwh_night_change_pct: -0.4, m3_night_change_pct: -0.2 }]));
  assert.doesNotMatch(h, /-0(\b|%)/); assert.ok(!/KB_c K_ok"><i class="KB_a">🔻<\/i>0%/.test(h), 'no arrow on a zero change'); assert.ok(h.includes('<span class="KB_c">0%</span>'));
});

test('s127 r1 faces: no located face = the first initial only, never the ID path; a fallback frame is the same', async () => {
  const a = NEW_ADMIN(); a.stays[0].id_face_box = null; a.stays[0].id_photo_path = 'secret/id-77';
  let h = await openAdmin(adminWith([], a)); assert.ok(!h.includes('secret/id-77'), 'no box: the ID path is not in the page'); assert.ok(!h.includes('data-facepath')); assert.match(h, /KG_face KG_vip" aria-hidden="true">&lt;<\/span>|KG_face KG_vip" aria-hidden="true">[^<]{1,2}<\/span>/);
  const b = NEW_ADMIN(); b.stays[0].id_photo_path = 'secret/id-78';
  h = await openAdmin(mountWith(base({ admin: b }), 'owner', {}, { scale: 1, w: 44, h: 44, left: 0, top: 0, fallback: true })); assert.ok(!h.includes('secret/id-78') && !h.includes('data-facepath'), 'a fallback frame (no usable box) shows the initial only');
  h = await openAdmin(adminWith([], b)); assert.ok(h.includes('data-facepath="secret/id-78"'), 'a located face is placed by the shell loader');
});

test('s127 r1 escape: the photo path, the source links and the name are escaped wherever they are written', async () => {
  const a = NEW_ADMIN(); a.stays[0].id_photo_path = 'x" onerror="alert(1)'; a.water_rate.source_url = 'https://a.b/"><script>x</script>'; a.rate.source_url = 'https://c.d/"><img src=x>'; a.stays[1].guest_name = 'Q"><i>';
  const h = await openAdmin(adminWith(PN(), a));
  assert.doesNotMatch(h, /"><script>|" onerror="|"><img src=x>|"><i>/); assert.ok(h.includes('&quot; onerror=&quot;')); assert.ok(h.includes('&quot;&gt;&lt;script&gt;')); assert.ok(h.includes('Q&quot;&gt;&lt;i&gt;'));
});

// the Today bills card drives the real shell
const BILLS_OK = () => ({ error: null, data: { since: '2026-10-21', last_reading_at: '2026-10-14T02:00:00Z', electric: { php: 4314.35, kwh: 383 }, water: { php: 212, m3: 7.2 } } });
const todayHtml = async (role, bills, then) => { const app = await boot({ role, hash: '#home', handlers: baseHandlers(role, { today_bills_v1: bills }) }); if (then) await then(app); return app.els['v-home'].innerHTML; };

test('s127 r1 Today card: a cleaner (no admin money) sees the card; a 42501 refusal and a missing RPC draw nothing', async () => {
  const c = await todayHtml('cleaner', BILLS_OK); assert.match(c, /id="T_bills"/); assert.ok(c.includes('₱4,314.35') || c.includes('₱4,314'), 'pesos for every role'); assert.ok(c.includes('383 kWh')); assert.ok(c.includes('7.2 m³'));
  for (const err of [{ code: '42501', message: 'permission denied' }, { code: 'PGRST202', message: 'Could not find the function' }]) assert.doesNotMatch(await todayHtml('owner', () => ({ error: err, data: null })), /T_bills/, err.code);
  assert.doesNotMatch(await todayHtml('owner', () => ({ error: null, data: { since: 'no' } })), /T_bills/, 'an answer that is not the contract shape draws nothing');
});

test('s127 r1 Today card: a later failed load keeps the card already shown; a later permission refusal removes it', async () => {
  let n = 0; const flaky = (second) => () => (++n === 1 ? BILLS_OK() : second);
  n = 0; let h = await todayHtml('owner', flaky({ error: { message: 'boom' }, data: null }), (app) => app.click({ 'data-act': 'refresh' })); assert.match(h, /id="T_bills"/, 'a network-style error keeps the last good card'); assert.ok(n >= 2, 'the second load ran');
  n = 0; h = await todayHtml('owner', flaky({ error: { code: '42501', message: 'denied' }, data: null }), (app) => app.click({ 'data-act': 'refresh' })); assert.doesNotMatch(h, /T_bills/, 'a refusal clears the card');
});

test('s127 release: 3.4.43 with cs-shell-v68', () => {
  assert.equal(JSON.parse(read('package.json')).version, '3.4.43'); assert.match(read('app.js'), /version: '3.4.43'/); assert.match(read('sw.js'), /CACHE_NAME = 'cs-shell-v68'/); assert.match(read('app.js'), /var PC_SHELL = 'cs-shell-v68';/);
});
