// s110 lane C: the KPIs tab, the Inventory card on Today, report consumption, report supply (receipt -> review -> confirm -> undo) and the laundry role.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { CS, D, read, boot, baseHandlers, HOMEWITH, stayRow, TODAY } from './_a_harness.mjs';

const clone = (x) => JSON.parse(JSON.stringify(x));
const tick = async (n = 24) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

// ---- the real module files, run against a window of our own (no browser needed)
function blobStub(size) { return { size: size || 1000, type: 'image/jpeg', arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }; }
function makeWin(extra) {
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage() {} }), toBlob: (cb) => cb(blobStub()) };
  const win = Object.assign({ ICON: (n) => '<svg data-i="' + n + '"></svg>', document: { createElement: () => canvas }, createImageBitmap: async () => ({ width: 3000, height: 2000, close() {} }), btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    crypto: { randomUUID: (() => { let n = 0; return () => 'uuid-' + (++n); })() } }, extra || {});
  win.window = win; return win;
}
function loadModule(file, win) { vm.runInContext(read(file), vm.createContext(win)); return win; }
function miniEl() {
  const L = {}; return { innerHTML: '', L, addEventListener: (t, f) => { (L[t] ||= []).push(f); }, removeEventListener() {}, querySelector: () => null };
}
const target = (attrs, extra) => { const t = Object.assign({ getAttribute: (n) => (n in attrs ? attrs[n] : null), hasAttribute: (n) => n in attrs, id: attrs.id || '' }, extra || {}); t.closest = () => t; return t; };
const fire = async (el, type, t) => { for (const f of el.L[type] || []) f({ target: t, preventDefault() {} }); await tick(); };
const clickK = (el, name, attrs) => fire(el, 'click', target(Object.assign({ 'data-kact': name }, attrs || {})));
const clickS = (el, name, attrs) => fire(el, 'click', target(Object.assign({ 'data-sact': name }, attrs || {})));
function fakeClient(handlers, fns, extra) {
  const calls = [];
  return { calls, rpc: (n, a) => { calls.push([n, clone(a || {})]); const h = handlers[n]; return Promise.resolve(h ? h(a) : { data: null, error: { code: 'PGRST202', message: 'not found' } }); },
    functions: { invoke: (n, o) => { calls.push(['fn:' + n, clone(o.body)]); const h = (fns || {})[n]; return Promise.resolve(h ? h(o.body) : { data: { ok: true }, error: null }); } },
    storage: { from: (b) => ({ createSignedUrls: (paths, secs) => { calls.push(['sign:' + b, clone(paths), secs]); return Promise.resolve({ data: paths.map((p) => ({ path: p, signedUrl: 'https://signed.example/' + p })) }); } }) }, ...(extra || {}) };
}

const KPI = (admin) => Object.assign({ ok: true, month: '2026-10-01',
  utility: { kwh_month: 412, nights_month: 22, kwh_per_night: 18.7, last_reading: { recorded_at: '2026-10-14T02:00:00Z', delta_kwh: 38.2, nights: 2, kwh_per_night: 19.1, flag: null },
    per_stay: [14, 18, 12, 24, 16, 13, 15, 14].map((v, i) => ({ checkout_date: '2026-10-0' + (i + 1), kwh_per_night: v })), brownouts: { count: 2, hours: 9 }, water_cuts: { count: 1, hours: 5 } },
  inventory: { low_now: 5, restocks_month: 3, turnovers_month: 9, per_turnover: [{ item_id: 'a', name: 'Toilet paper', used_per_turnover: 2.1, usual: 2 }, { item_id: 'b', name: 'Water bottles', used_per_turnover: 4.6, usual: 4 }],
    runs_out: [{ item_id: 'c', name: 'Hand soap', days_left: 4 }, { item_id: 'd', name: 'Garbage bags', days_left: 21 }] } },
  admin ? { admin: { rate: { php_per_kwh: 11.25, effective_from: '2026-09-20', source: 'auto', source_url: 'https://www.facebook.com/socoteco2.EC/' }, last_reading_cost: 429.75, month_kwh_cost: 4635, supplies_month: 4950, supply_cost_per_turnover: 550, cleaning_pay_month: 6300 } } : {});

// ---------------------------------------------------------------------------------------------- 1. role helpers
test('s110 laundry role: staff layout, own tab set, no checklist door, no guest contact, KPIs money only for owner/admin/finance', () => {
  assert.equal(CS.layoutForRole('laundry'), 'staff'); assert.equal(CS.isLaundry('laundry'), true); assert.equal(CS.isLaundry('cleaner'), false);
  assert.deepEqual(CS.tabKeys('laundry'), ['home', 'calendar', 'stock', 'kpis', 'more']);
  for (const r of ['owner', 'admin', 'finance', 'cleaner', 'inspector', 'maintenance']) assert.deepEqual(CS.tabKeys(r), ['home', 'calendar', 'tasks', 'kpis', 'more'], r);
  assert.equal(CS.doorAllowed('checklist', 'laundry'), false); assert.deepEqual(CS.doorsForRole('laundry'), ['manual', 'guide']);
  assert.equal(CS.canSeeGuestContact('laundry'), false); assert.equal(CS.accessVerdict({ role: 'laundry', disabled: false, session_current: true }).ok, true);
  for (const r of ['owner', 'admin', 'finance']) assert.equal(CS.kpiAdmin(r), true, r);
  for (const r of ['cleaner', 'inspector', 'maintenance', 'laundry', '', null]) assert.equal(CS.kpiAdmin(r), false, String(r));
});

// ---------------------------------------------------------------------------------------------- 2. pure KPI helpers
test('s110 K_Kpi.lib: bars, usage rows, money keys only for the money roles, forms refuse bad numbers', () => {
  const K = loadModule('kpi/K_kpi.js', makeWin()).K_Kpi.lib;
  const bars = K.barHeights([14, 18, 12, 24, 16, 13, 15, 14]); assert.equal(bars.length, 8); assert.equal(bars[3].pct, 100); assert.equal(bars[3].hi, true); assert.equal(bars.filter((b) => b.hi).length, 1);
  assert.equal(K.barHeights([0, 0])[0].pct, 8, 'a flat zero still draws'); assert.deepEqual(K.barHeights([]), []);
  const u = K.usageRows([{ name: 'Toilet paper', used_per_turnover: 2.1, usual: 2 }, { name: 'Water', used_per_turnover: 4.6, usual: 4 }, { name: 'Coffee', used_per_turnover: 3, usual: 4 }, { name: '', used_per_turnover: 1 }]);
  assert.equal(u.length, 3); assert.deepEqual(u.map((r) => r.over), [false, true, false]); assert.equal(u[1].overPct, 15);
  assert.equal(K.daysTone(4), 'bad'); assert.equal(K.daysTone(9), 'warn'); assert.equal(K.daysTone(21), 'ok');
  assert.equal(K.monthLabel('2026-10-01'), 'October 2026'); assert.equal(K.daysIn('2026-02-01'), 28);
  for (const role of ['owner', 'admin', 'finance']) assert.equal(K.normalize(KPI(true), role).admin.rate.php, 11.25, role);
  for (const role of ['cleaner', 'laundry', 'inspector', 'maintenance']) assert.equal(K.normalize(KPI(true), role).admin, null, role + ' never keeps the admin keys');
  assert.equal(K.normalize({ ok: false, error: 'forbidden' }, 'owner'), null);
  assert.equal(K.normalize(KPI(true), 'owner').admin.rate.url, 'https://www.facebook.com/socoteco2.EC/'); assert.equal(K.normalize({ ...KPI(true), admin: { rate: { php_per_kwh: 11, source_url: 'javascript:alert(1)' } } }, 'owner').admin.rate.url, '', 'only https links');
  assert.equal(K.rateProblem('11.25', '2026-11-01'), null); assert.ok(K.rateProblem('0', '2026-11-01')); assert.ok(K.rateProblem('100', '2026-11-01')); assert.ok(K.rateProblem('abc', '2026-11-01')); assert.ok(K.rateProblem('11', ''));
  const row = { prevE: 4272, prevW: 805 }; assert.equal(K.correctionProblem(row, '4310', '812'), null); assert.match(K.correctionProblem(row, '4000', '812'), /electric/); assert.match(K.correctionProblem(row, '4310', '800'), /water/); assert.match(K.correctionProblem(row, '', '812'), /both/);
  assert.deepEqual(clone(K.blockCall('r1', 'typed_is_right', null, null, '')), { fn: 'admin_resolve_report_block_v1', args: { p_reading_id: 'r1', p_action: 'typed_is_right', p_electric: null, p_water: null, p_note: null } });
  assert.deepEqual(clone(K.resendCall('r1', '')), { fn: 'admin_request_meter_resend_v1', args: { p_reading_id: 'r1', p_note: null } });
  assert.deepEqual(clone(K.rateCall('11.5', '2026-11-01', ' new ')), { fn: 'utility_rate_set_v1', args: { p_php_per_kwh: 11.5, p_effective_from: '2026-11-01', p_note: 'new' } });
});

// ---------------------------------------------------------------------------------------------- 3. the KPIs screen, through the app, by role
const withModules = (win) => { win.H_loadAsset = (m) => { vm.runInContext(read(m.src), vm.createContext(Object.assign(win, { document: win.document }))); return Promise.resolve(); }; win.window = win; };
async function kpiScreen(role, payload) {
  const h = baseHandlers(role, { kpi_tab_v1: () => ({ error: null, data: payload }), admin_report_blocks_v1: () => ({ error: { code: '42501', message: 'x' }, data: null }) });
  const app = await boot({ role, hash: '#kpis', winInit: withModules, handlers: h });
  return { app, html: app.els['H_mod-kpis'].innerHTML, calls: app.calls };
}
test('s110 KPIs tab: owner and finance get Utility, Inventory and Admin; cleaner, inspector and laundry get two segments and never a peso', async () => {
  for (const role of ['owner', 'finance']) { const { html, calls } = await kpiScreen(role, KPI(true)); assert.match(html, /data-seg="admin"/, role); assert.match(html, /data-seg="utility"[\s\S]*data-seg="inventory"/); assert.ok(calls.some((c) => c[0] === 'kpi_tab_v1' && c[1].p_month === null), 'kpi_tab_v1 asked for the current month'); }
  for (const role of ['cleaner', 'inspector', 'laundry']) {
    const { html, app } = await kpiScreen(role, KPI(true)); // even a payload that wrongly carries the admin key
    assert.doesNotMatch(html, /data-seg="admin"/, role); assert.match(html, /412 kWh/); assert.doesNotMatch(html, /₱|PHP|11\.25|4,635|429/, role + ': no money anywhere');
    assert.match(html, /role="tablist"/); assert.equal((html.match(/role="tab"/g) || []).length, 2);
    assert.match(app.els.tabbar.innerHTML, /href="#kpis"/, role + ' has the KPIs tab');
  }
  const bad = await kpiScreen('owner', { ok: false, error: 'forbidden' }); assert.match(bad.html, /not open to your account/);
});

// ---------------------------------------------------------------------------------------------- 4. the Admin segment and the meter checks, driven by clicks
function adminKpi(role, over) {
  const h = { kpi_tab_v1: () => ({ error: null, data: KPI(true) }),
    admin_report_blocks_v1: () => ({ error: null, data: [{ reading_id: 'r1', session_id: 's1', cleaner_name: 'Ana Reyes', checkout_date: '2026-10-13', recorded_at: '2026-10-14T01:00:00Z', typed_electric: 4310, typed_water: 812, prev_electric: 4272, prev_water: 805, photo_electric: 4301, photo_water: 812, photo_note_electric: null, photo_note_water: null, photo_path_electric: 'cs/e1.jpg', photo_path_water: 'cs/w1.jpg', resend_requested_at: null }] }),
    admin_resolve_report_block_v1: () => ({ error: null, data: { ok: true } }), admin_request_meter_resend_v1: () => ({ error: null, data: { ok: true } }), utility_rate_set_v1: () => ({ error: null, data: { ok: true, id: 'u1' } }) };
  const client = fakeClient(Object.assign(h, over || {})), win = loadModule('kpi/K_kpi.js', makeWin()), el = miniEl(), toasts = [];
  win.K_Kpi.mount(el, { client, role, propertyId: 'prop-1', toast: (t) => toasts.push(t) });
  return { client, el, toasts, K: win.K_Kpi };
}
test('s110 Admin segment: rate, last reported consumption at that rate, costs, Update rate for owner/admin only', async () => {
  const o = adminKpi('owner'); await tick(); await clickK(o.el, 'seg', { 'data-seg': 'admin' });
  assert.match(o.el.innerHTML, /₱11\.25 per kWh/); assert.match(o.el.innerHTML, /About ₱430 for 38\.2 kWh over 2 nights, at ₱11\.25 per kWh/); assert.match(o.el.innerHTML, /₱4,635/); assert.match(o.el.innerHTML, /₱550/); assert.match(o.el.innerHTML, /₱6,300/);
  assert.match(o.el.innerHTML, /data-kact="rate-open"/); assert.match(o.el.innerHTML, /href="#manage\/kpis"/, 'the full key figures stay one tap away');
  await clickK(o.el, 'rate-open'); await fire(o.el, 'input', target({}, { id: 'K_f_php', value: '12,5' })); await fire(o.el, 'input', target({}, { id: 'K_f_from', value: '2026-11-01' }));
  await fire(o.el, 'submit', target({ 'data-kform': 'rate' })); await tick();
  assert.deepEqual(o.client.calls.filter((c) => c[0] === 'utility_rate_set_v1'), [['utility_rate_set_v1', { p_php_per_kwh: 12.5, p_effective_from: '2026-11-01', p_note: null }]]);
  assert.ok(o.client.calls.filter((c) => c[0] === 'kpi_tab_v1').length === 2, 'the figures reload after the rate is saved');
  await clickK(o.el, 'rate-open'); await fire(o.el, 'input', target({}, { id: 'K_f_php', value: '500' })); await fire(o.el, 'submit', target({ 'data-kform': 'rate' }));
  assert.equal(o.client.calls.filter((c) => c[0] === 'utility_rate_set_v1').length, 1, 'a rate out of range is refused before the server'); assert.match(o.el.innerHTML, /for example 11\.25/);
  const f = adminKpi('finance'); await tick(); await clickK(f.el, 'seg', { 'data-seg': 'admin' });
  assert.match(f.el.innerHTML, /₱11\.25 per kWh/); assert.doesNotMatch(f.el.innerHTML, /rate-open|Update rate/, 'finance reads, owner and admin edit'); assert.doesNotMatch(f.el.innerHTML, /#manage\/kpis/);
  const c = adminKpi('cleaner'); await tick(); await clickK(c.el, 'seg', { 'data-seg': 'admin' }); assert.doesNotMatch(c.el.innerHTML, /₱|Admin/, 'a cleaner cannot open the Admin segment');
  const none = adminKpi('owner', { kpi_tab_v1: () => ({ error: null, data: KPI(false) }) }); await tick(); await clickK(none.el, 'seg', { 'data-seg': 'admin' }); assert.match(none.el.innerHTML, /not available yet/); assert.doesNotMatch(none.el.innerHTML, /₱/);
});
test('s110 Meter checks: signed photos, typed vs photo numbers, the three answers with their exact RPC arguments', async () => {
  const o = adminKpi('admin'); await tick(); await clickK(o.el, 'seg', { 'data-seg': 'admin' }); await tick();
  assert.match(o.el.innerHTML, /Meter checks/); assert.match(o.el.innerHTML, /Typed numbers and photos do not match/); assert.match(o.el.innerHTML, /Photo reads 4301/);
  assert.deepEqual(o.client.calls.find((c) => c[0] === 'sign:cleaning-photos'), ['sign:cleaning-photos', ['cs/e1.jpg', 'cs/w1.jpg'], 900]);
  assert.match(o.el.innerHTML, /<img src="https:\/\/signed\.example\/cs\/e1\.jpg"/);
  await clickK(o.el, 'resend', { 'data-id': 'r1' });
  assert.deepEqual(o.client.calls.find((c) => c[0] === 'admin_request_meter_resend_v1'), ['admin_request_meter_resend_v1', { p_reading_id: 'r1', p_note: null }]);
  assert.match(o.el.innerHTML, /A new photo was asked for/, 'the row stays and says it was asked');
  await clickK(o.el, 'fix-open', { 'data-id': 'r1' }); await fire(o.el, 'input', target({ 'data-fix': 'e', 'data-id': 'r1' }, { id: 'K_fe_r1', value: '4000' }));
  await clickK(o.el, 'fix-save', { 'data-id': 'r1' }); assert.match(o.el.innerHTML, /electric number cannot be below/); assert.equal(o.client.calls.filter((c) => c[0] === 'admin_resolve_report_block_v1').length, 0);
  await fire(o.el, 'input', target({ 'data-fix': 'e', 'data-id': 'r1' }, { id: 'K_fe_r1', value: '4310' })); await clickK(o.el, 'fix-save', { 'data-id': 'r1' });
  assert.deepEqual(o.client.calls.find((c) => c[0] === 'admin_resolve_report_block_v1'), ['admin_resolve_report_block_v1', { p_reading_id: 'r1', p_action: 'correct_numbers', p_electric: 4310, p_water: 812, p_note: null }]);
  assert.match(o.el.innerHTML, /No meter readings need a look/);
  const t = adminKpi('owner'); await tick(); await clickK(t.el, 'seg', { 'data-seg': 'admin' }); await clickK(t.el, 'typed-ok', { 'data-id': 'r1' });
  assert.deepEqual(t.client.calls.find((c) => c[0] === 'admin_resolve_report_block_v1'), ['admin_resolve_report_block_v1', { p_reading_id: 'r1', p_action: 'typed_is_right', p_electric: null, p_water: null, p_note: null }]);
  const fin = adminKpi('finance', { admin_report_blocks_v1: () => ({ error: { code: '42501', message: 'not authorized' }, data: null }) }); await tick(); await clickK(fin.el, 'seg', { 'data-seg': 'admin' });
  assert.doesNotMatch(fin.el.innerHTML, /Meter checks/, 'a role the server refuses never sees the card');
});

// ---------------------------------------------------------------------------------------------- 5. Today and the tab bar, through the app
const homeFor = async (role, hash = '#home', extra) => boot({ role, hash, winInit: withModules, handlers: baseHandlers(role, Object.assign({ staff_home_v1: () => HOMEWITH([stayRow('Ana Reyes', TODAY, '2026-10-17', { checkin_time: '14:00', checkout_time: '12:00' }), stayRow('Ben Cruz', '2026-10-10', TODAY)]) }, extra || {})) });
test('s110 Today: the Inventory card with three big buttons for staff and admin layouts; the tab bar by role', async () => {
  for (const role of ['cleaner', 'owner', 'finance']) {
    const h = (await homeFor(role)).els['v-home'].innerHTML;
    assert.match(h, /id="K_inv"/, role); assert.equal((h.match(/class="btn btn-secondary btn-block K_inv-btn"/g) || []).length, 3, role + ': three big buttons');
    assert.match(h, /href="#stock"[^>]*data-k="Check inventory"/); assert.match(h, /href="#supply\/use"[^>]*data-k="Report consumption"/); assert.match(h, /href="#supply"[^>]*data-k="Report supply"/);
  }
  const tabs = (await homeFor('cleaner')).els.tabbar.innerHTML; assert.deepEqual([...tabs.matchAll(/href="(#[a-z]+)"/g)].map((m) => m[1]), ['#home', '#calendar', '#tasks', '#kpis', '#more']);
  const own = (await homeFor('owner', '#kpis')).els.tabbar.innerHTML; assert.match(own, /href="#kpis" aria-current="page"/);
});
test('s110 Laundry: Today without Turnover, nudges, clean-done card, checklist door or cleaning fee; Inventory tab; calendar privacy; no money', async () => {
  const app = await homeFor('laundry'); const h = app.els['v-home'].innerHTML;
  assert.doesNotMatch(h, /Turnover today|aria-label="Turnover|Walk through first|Start cleaning|H_cleandone|Clean done|slot-paid-notice|slot-owed|Cleaning fee|Start or continue/i);
  assert.doesNotMatch(h, /door\/checklist|CH-Cleaners-Checklist|data-primary="start-cleaning"/); assert.match(h, /id="K_inv"/); assert.match(h, /Today in the house|Up next|Calendar/);
  assert.doesNotMatch(h, /₱|PHP/);
  assert.deepEqual([...app.els.tabbar.innerHTML.matchAll(/href="(#[a-z]+)"/g)].map((m) => m[1]), ['#home', '#calendar', '#stock', '#kpis', '#more']);
  assert.match(app.els.tabbar.innerHTML, />Inventory</);
  const cal = (await homeFor('laundry', '#calendar')).els['v-calendar'].innerHTML; assert.doesNotMatch(cal, /tel:|mailto:|id_photo|0900|₱|PHP/);
  const loaded = []; const st = await boot({ role: 'laundry', hash: '#stock', winInit: (w) => { w.H_loadAsset = (m) => { loaded.push(m.src); w[m.global] = { mount() {} }; return Promise.resolve(); }; }, handlers: baseHandlers('laundry') });
  assert.ok(loaded.includes('stock/I_stock.js'), 'laundry may open the stock screen'); const sv = st.els['v-stock'].innerHTML;
  assert.match(sv, /href="#supply\/use"/); assert.match(sv, /href="#supply"/); assert.doesNotMatch(sv, /Check inventory/, 'she is already on it'); assert.match(st.els.tabbar.innerHTML, /href="#stock" aria-current="page"/);
  const sup = []; await boot({ role: 'laundry', hash: '#supply/use', winInit: (w) => { w.H_loadAsset = (m) => { sup.push(m.src); w[m.global] = { mount() {} }; return Promise.resolve(); }; }, handlers: baseHandlers('laundry') }); assert.deepEqual(sup, ['stock/S110_supply.js']);
  const fin = []; const f = await boot({ role: 'finance', hash: '#supply', winInit: (w) => { w.H_loadAsset = (m) => { fin.push(m.src); return Promise.resolve(); }; }, handlers: baseHandlers('finance') }); assert.deepEqual(fin, [], 'finance holds no report_supply: nothing loads'); assert.equal(f.els['v-supply'].innerHTML, '');
  assert.doesNotMatch(read('stock/S110_supply.js') + read('kpi/K_kpi.js'), /\.unit_cost|unitCost|\.total|total_amount|\.price/, 'no price key is read by the new screens');
});

// ---------------------------------------------------------------------------------------------- 6. report consumption
const CATALOGUE = { ok: true, items: [{ id: 'i1', name: 'Toilet paper', category: 'Bathroom', unit: 'rolls', consumable: true, active: true, qty: 10 }, { id: 'i2', name: 'Hand <b>soap</b>', category: 'Bathroom', unit: 'bottles', consumable: true, active: true, qty: 4 },
  { id: 'i3', name: 'Bath towels', category: 'Linen', unit: 'pcs', consumable: false, active: true, qty: 12 }, { id: 'i4', name: 'Old thing', category: 'Misc', unit: 'pcs', consumable: true, active: false, qty: 1 }] };
function supplyMount(sub, handlers, fns, role) {
  const client = fakeClient(Object.assign({ get_inventory_catalogue_v1: () => ({ error: null, data: CATALOGUE }) }, handlers || {}), fns), win = loadModule('stock/S110_supply.js', makeWin()), el = miniEl(), navs = [], toasts = [];
  win.S110_Supply.mount(el, { client, role: role || 'laundry', sub, propertyId: 'prop-1', navigate: (h) => navs.push(h), toast: (t) => toasts.push(t) });
  return { client, el, navs, toasts, M: win.S110_Supply };
}
test('s110 Report consumption: consumable active items only, steppers, record_inventory_usage rows with a retry-safe key per row', async () => {
  let fails = 1; const s = supplyMount('use', { record_inventory_usage: () => (fails-- > 0 ? { error: { message: 'network down' }, data: null } : { error: null, data: { ok: true, rows: 2 } }) });
  await tick(); const h = s.el.innerHTML; assert.match(h, /Toilet paper/); assert.match(h, /Hand &lt;b&gt;soap&lt;\/b&gt;/, 'names are escaped'); assert.doesNotMatch(h, /Bath towels|Old thing/);
  assert.match(h, /disabled>Record</, 'nothing to record yet');
  await clickS(s.el, 'inc', { 'data-id': 'i1' }); await clickS(s.el, 'inc', { 'data-id': 'i1' }); await clickS(s.el, 'inc', { 'data-id': 'i2' }); await clickS(s.el, 'dec', { 'data-id': 'i2' }); await clickS(s.el, 'inc', { 'data-id': 'i2' });
  await fire(s.el, 'input', target({ 'data-q': 'i2' }, { id: 'S_q_i2', value: '0,5' }));
  await clickS(s.el, 'use-save'); assert.match(s.el.innerHTML, /Nothing was saved/); const first = s.client.calls.find((c) => c[0] === 'record_inventory_usage');
  assert.equal(first[1].p_property_id, 'prop-1'); assert.match(first[1].p_session_date, /^\d{4}-\d{2}-\d{2}$/); assert.equal(first[1].p_logged_by, null); assert.equal(first[1].p_notes, 'Logged in the staff app');
  assert.deepEqual(first[1].p_rows.map((r) => [r.item_id, r.used_qty]), [['i2', 0.5], ['i1', 2]]); assert.ok(first[1].p_rows.every((r) => /^stk-use-/.test(r.usage_key)));
  await clickS(s.el, 'use-save'); const calls = s.client.calls.filter((c) => c[0] === 'record_inventory_usage');
  assert.equal(calls.length, 2); assert.deepEqual(calls[1][1].p_rows.map((r) => r.usage_key), first[1].p_rows.map((r) => r.usage_key), 'the retry sends the same keys, so nothing is counted twice');
  assert.match(s.el.innerHTML, /Thank you\. 2 items recorded/); assert.match(s.el.innerHTML, /href="#home"/);
  const f = supplyMount('use', { get_inventory_catalogue_v1: () => ({ error: { code: '42501' }, data: null }) }); await tick(); assert.match(f.el.innerHTML, /could not be loaded/);
});

// ---------------------------------------------------------------------------------------------- 7. report supply
const DRAFT = (over) => ({ error: null, data: { ok: true, draft: Object.assign({ id: 'dr-1', vendor: 'Demo Hardware', purchased_on: '2026-10-14', receipt_path: 'p/u/1.jpg', status: 'draft', lines: [
  { line_no: 1, description: 'TOILET TISSUE 12S', qty: 2, match: { item_id: 'i1', name: 'Toilet paper', unit: 'rolls', photo_path: null } },
  { line_no: 2, description: 'LIQ SOAP 500ML', qty: 3, match: null },
  { line_no: 3, description: 'SCENTED CANDLE', qty: 1, match: null },
  { line_no: 4, description: 'PLASTIC BAG', qty: 1, match: null }] }, over || {}) } });
const file = (o) => Object.assign({ type: 'image/jpeg', name: 'receipt.jpg' }, o || {});
async function toReview(s) { await tick(); await fire(s.el, 'change', target({ 'data-sfile': 'receipt' }, { files: [file()] })); await tick(); }

test('s110 Report supply: photo -> ocr-receipt supply -> draft -> review; manual lines, change item, new item with photo, skip; confirm sends the key once; Undo', async () => {
  let confirms = 0;
  const s = supplyMount('', { inventory_receipt_draft_v1: () => DRAFT(), inventory_receipt_confirm_v1: (a) => { confirms++; return confirms === 1 ? { error: { message: 'network down' }, data: null } : { error: null, data: { ok: true, purchase_count: 3, new_items: [{ line_no: 3, item_id: 'ni-3' }], undo_token: 't' } }; },
    inventory_item_photo_set_v1: () => ({ error: null, data: { ok: true } }), inventory_receipt_undo_v1: () => ({ error: null, data: { ok: true } }), inventory_receipt_cancel_v1: () => ({ error: null, data: { ok: true } }) },
  { 'ocr-receipt': () => ({ data: { ok: true, draft_id: 'dr-1' }, error: null }), 'upload-photo': () => ({ data: { ok: true, path: 'items/ni-3/p.jpg' }, error: null }) });
  await tick(); assert.match(s.el.innerHTML, /Take a photo of the receipt/); assert.match(s.el.innerHTML, /Enter it by hand instead/); assert.match(s.el.innerHTML, /capture="environment"/);
  await fire(s.el, 'change', target({ 'data-sfile': 'receipt' }, { files: [file({ type: 'application/pdf', name: 'r.pdf' })] })); assert.match(s.el.innerHTML, /not a PDF/); assert.equal(s.client.calls.filter((c) => c[0] === 'fn:ocr-receipt').length, 0);
  await toReview(s);
  const names = s.client.calls.map((c) => c[0]); assert.deepEqual(names.filter((n) => /ocr-receipt|inventory_receipt/.test(n)), ['fn:ocr-receipt', 'inventory_receipt_draft_v1']);
  const ocr = s.client.calls.find((c) => c[0] === 'fn:ocr-receipt')[1]; assert.equal(ocr.mode, 'supply'); assert.equal(ocr.mime_type, 'image/jpeg'); assert.equal(ocr.image_base64, 'AQID'); assert.deepEqual(Object.keys(ocr).sort(), ['image_base64', 'mime_type', 'mode']);
  assert.deepEqual(s.client.calls.find((c) => c[0] === 'inventory_receipt_draft_v1')[1], { p_draft_id: 'dr-1' });
  let h = s.el.innerHTML; assert.match(h, /Check each line/); assert.match(h, /TOILET TISSUE 12S/); assert.match(h, /Toilet paper/); assert.equal((h.match(/No match yet/g) || []).length, 3); assert.doesNotMatch(h, /₱|PHP|unit_cost/);
  // an unfinished review is refused on the client and says which lines
  await clickS(s.el, 'confirm'); assert.equal(s.client.calls.filter((c) => c[0] === 'inventory_receipt_confirm_v1').length, 0); assert.equal((s.el.innerHTML.match(/Pick the item, add it as new, or skip this line/g) || []).length, 3);
  // line 2: change to an existing item; line 3: new item with a photo; line 4: skip; line 1 quantity 5
  await clickS(s.el, 'line-pick', { 'data-line': '2' }); await fire(s.el, 'change', target({ 'data-pick': '2' }, { value: 'i2' }));
  await clickS(s.el, 'line-new', { 'data-line': '3' }); await fire(s.el, 'input', target({ 'data-nw': 'name', 'data-line': '3' }, { id: 'S_nn_3', value: 'Vanilla candle' }));
  await fire(s.el, 'change', target({ 'data-nw': 'category', 'data-line': '3' }, { value: 'Uncategorised' })); await fire(s.el, 'input', target({ 'data-nw': 'unit', 'data-line': '3' }, { id: 'S_nu_3', value: 'pc' })); await fire(s.el, 'change', target({ 'data-nw': 'cons', 'data-line': '3' }, { value: 'no' }));
  await fire(s.el, 'change', target({ 'data-sfile': 'item', 'data-line': '3' }, { files: [file()] }));
  await clickS(s.el, 'line-skip', { 'data-line': '4' }); await fire(s.el, 'input', target({ 'data-q': 'L1' }, { id: 'S_q_L1', value: '5' }));
  await clickS(s.el, 'link-use', { 'data-line': '3' }); // an empty link is refused
  await fire(s.el, 'input', target({ 'data-link': '1', 'data-line': '3' }, { id: 'S_nl_3', value: 'https://example.com/x.jpg' })); await clickS(s.el, 'link-use', { 'data-line': '3' }); assert.match(s.el.innerHTML, /cdn\.shopify\.com or down-ph\.img\.susercontent\.com/);
  await clickS(s.el, 'confirm'); // first try: the network fails
  assert.match(s.el.innerHTML, /Nothing was saved/); const c1 = s.client.calls.filter((c) => c[0] === 'inventory_receipt_confirm_v1')[0][1];
  assert.deepEqual(c1.p_lines, [{ line_no: 1, item_id: 'i1', new_item: null, qty_units: 5, skip: false }, { line_no: 2, item_id: 'i2', new_item: null, qty_units: 3, skip: false },
    { line_no: 3, item_id: null, new_item: { name: 'Vanilla candle', category: 'Uncategorised', unit: 'pc', is_consumable: false }, qty_units: 1, skip: false }, { line_no: 4, item_id: null, new_item: null, qty_units: 1, skip: true }]);
  assert.equal(c1.p_draft_id, 'dr-1'); assert.equal(c1.p_purchased_on, '2026-10-14'); assert.match(c1.p_idempotency_key, /^stk-rcpt-\w+$/);
  await clickS(s.el, 'confirm'); const cs = s.client.calls.filter((c) => c[0] === 'inventory_receipt_confirm_v1'); assert.equal(cs.length, 2);
  assert.equal(cs[1][1].p_idempotency_key, c1.p_idempotency_key, 'a retry sends the same key: the receipt is recorded once');
  assert.match(s.el.innerHTML, /Thank you\. 3 lines added to stock/); assert.match(s.el.innerHTML, />Undo</);
  await clickS(s.el, 'confirm'); assert.equal(s.client.calls.filter((c) => c[0] === 'inventory_receipt_confirm_v1').length, 2, 'once done, the screen has no confirm to press again');
  const up = s.client.calls.find((c) => c[0] === 'fn:upload-photo')[1]; assert.deepEqual([up.purpose, up.propertyId, up.itemId, up.mimeType], ['inventory', 'prop-1', 'ni-3', 'image/jpeg']);
  assert.deepEqual(s.client.calls.find((c) => c[0] === 'inventory_item_photo_set_v1')[1], { p_item_id: 'ni-3', p_path: 'items/ni-3/p.jpg' });
  const order = s.client.calls.map((c) => c[0]).filter((n) => /^(fn:|inventory_)/.test(n)); assert.deepEqual(order, ['fn:ocr-receipt', 'inventory_receipt_draft_v1', 'inventory_receipt_confirm_v1', 'inventory_receipt_confirm_v1', 'fn:upload-photo', 'inventory_item_photo_set_v1']);
  await clickS(s.el, 'undo'); assert.deepEqual(s.client.calls.at(-1), ['inventory_receipt_undo_v1', { p_draft_id: 'dr-1' }]); assert.match(s.el.innerHTML, /back as it was/);
});
test('s110 Report supply: a receipt that cannot be read leaves the start screen; Cancel cancels the draft; confirm errors read as plain sentences; manual entry', async () => {
  const bad = supplyMount('', {}, { 'ocr-receipt': () => ({ data: { ok: false, error: 'ocr_failed' }, error: { message: 'x' } }) }); await toReview(bad);
  assert.match(bad.el.innerHTML, /could not be read/); assert.match(bad.el.innerHTML, /Take a photo of the receipt/); assert.equal(bad.client.calls.filter((c) => c[0] === 'inventory_receipt_draft_v1').length, 0);
  const s = supplyMount('', { inventory_receipt_draft_v1: () => DRAFT({ lines: [{ line_no: 1, description: 'TISSUE', qty: 1, match: { item_id: 'i1', name: 'Toilet paper', unit: 'rolls' } }] }), inventory_receipt_confirm_v1: () => ({ error: null, data: { ok: false, error: 'not_draft' } }), inventory_receipt_cancel_v1: () => ({ error: null, data: { ok: true } }) }, { 'ocr-receipt': () => ({ data: { ok: true, draft_id: 'dr-1' }, error: null }) });
  await toReview(s); await clickS(s.el, 'confirm'); assert.match(s.el.innerHTML, /already added/); await clickS(s.el, 'cancel');
  assert.deepEqual(s.client.calls.find((c) => c[0] === 'inventory_receipt_cancel_v1'), ['inventory_receipt_cancel_v1', { p_draft_id: 'dr-1' }]); assert.deepEqual(s.navs, ['#home']);
  const m = supplyMount('', { record_inventory_receipt_v1: () => ({ error: null, data: { ok: true } }) }); await tick(); await clickS(m.el, 'manual'); await clickS(m.el, 'inc', { 'data-id': 'M' }); await fire(m.el, 'change', target({ 'data-man': 'item' }, { value: 'i2' })); await clickS(m.el, 'man-save');
  const mc = m.client.calls.find((c) => c[0] === 'record_inventory_receipt_v1')[1]; assert.deepEqual([mc.p_item_id, mc.p_packs, mc.p_unit_cost, mc.p_receipt_path], ['i2', 2, null, null]); assert.match(mc.p_idempotency_key, /^stk-man-/); assert.match(m.el.innerHTML, /Thank you\. Hand &lt;b&gt;soap&lt;\/b&gt; is added to stock/);
  const L = loadModule('stock/S110_supply.js', makeWin()).S110_Supply.lib;
  assert.equal(L.picUrl('https://cdn.shopify.com/s/files/1/x.jpg'), 'https://cdn.shopify.com/s/files/1/x.jpg'); assert.equal(L.picUrl('http://cdn.shopify.com/x.jpg'), ''); assert.equal(L.picUrl('https://evil.example/cdn.shopify.com/x'), '');
  assert.deepEqual(clone(L.newItemIds({ new_items: ['a', 'b'] }, [{ line_no: 2, new_item: {} }, { line_no: 5, new_item: {} }])), { 2: 'a', 5: 'b' });
});

// ---------------------------------------------------------------------------------------------- 8. demo, files and house rules
test('s110 demo: laundry is a role, the fakes answer the new calls, and the admin key is absent for laundry and cleaner', async () => {
  assert.ok(D.ROLES.includes('laundry')); assert.equal(D.roleFrom('?demo&role=laundry'), 'laundry'); assert.match(D.barHtml('laundry'), /data-demo-role="laundry" aria-pressed="true"/);
  const c = (role) => D.client(role, new Date('2026-10-15T04:30:00Z'));
  assert.equal((await c('owner').rpc('kpi_tab_v1', {})).data.admin.rate.php_per_kwh, 11.25);
  for (const r of ['laundry', 'cleaner']) { const k = (await c(r).rpc('kpi_tab_v1', {})).data; assert.equal('admin' in k, false, r); assert.equal(D.build(r).access.role, r); }
  assert.equal((await c('laundry').rpc('current_staff_access', {})).data.role, 'laundry'); assert.equal(CS.layoutForRole(D.build('laundry').access.role), 'staff');
  assert.ok((await c('laundry').rpc('get_inventory_catalogue_v1', {})).data.items.some((i) => i.consumable));
  assert.equal((await c('admin').rpc('admin_report_blocks_v1', {})).data.length, 1); assert.equal((await c('laundry').rpc('admin_report_blocks_v1', {})).error.code, '42501');
  assert.equal((await c('owner').functions.invoke('ocr-receipt', { body: {} })).data.draft_id, 'demo-draft'); assert.equal((await c('owner').rpc('inventory_receipt_draft_v1', { p_draft_id: 'x' })).data.draft.lines.length, 3);
  const noted = []; D.onNote((m) => noted.push(m)); await c('laundry').rpc('record_inventory_usage', {}); assert.deepEqual(noted, [D.NOTE]); D.onNote(null);
});
test('s110 files and house rules: precached, no nowrap, no px font sizes, no raw colours, gaps on the scale', () => {
  const sw = read('sw.js'); for (const f of ['./kpi/K_kpi.js', './kpi/K_kpi.css', './stock/S110_supply.js']) assert.ok(sw.includes("'" + f + "'"), f);
  const html = read('index.html'); assert.match(html, /id="v-kpis"/); assert.match(html, /id="v-supply"/);
  const blk = read('styles.css').match(/\/\* s110 kpi-inventory[\s\S]*?\/\* end s110 kpi-inventory \*\//)[0];
  for (const [name, css] of [['kpi/K_kpi.css', read('kpi/K_kpi.css')], ['styles block', blk]]) {
    assert.doesNotMatch(css, /white-space\s*:\s*nowrap/, name); assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, name + ': no raw hex'); assert.doesNotMatch(css, /\brgba?\(|\bhsla?\(/, name + ': no raw colours');
    assert.doesNotMatch(css, /font(-size)?\s*:[^;}]*\b\d+(\.\d+)?px/, name + ': type only through --v5-t-* tokens');
    for (const m of css.matchAll(/(?:^|[;{\s])gap\s*:\s*([^;}]+)/g)) for (const v of m[1].trim().split(/\s+/)) assert.ok(['0', '4px', '8px', '12px', '16px', '24px'].includes(v), name + ' gap ' + v);
  }
  const k = read('kpi/K_kpi.js'), s = read('stock/S110_supply.js');
  for (const src of [k, s]) assert.doesNotMatch(src, /[A-Za-z.]!(?=['" <])/, 'no exclamation mark in the copy');
  assert.equal(read('index.html').includes('\r'), false); assert.equal(k.includes('\r') || s.includes('\r'), false, 'LF line endings');
});
