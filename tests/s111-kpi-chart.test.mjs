// s111 (Staff 3.4.29) rev 2. Lloyd 2026-11-08: "kwh per night is absurd ... make the graphs standard"; a Target card; zoom on photos; a Guest tiers card on Today.
// Hand-computed expectations throughout. KPI module runs in a vm with a fake client; the shell parts run through the lane A harness (frozen clock).
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { read, boot, baseHandlers, CS } from './_a_harness.mjs';

const tick = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const MONTHS = ['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
const perMonth = () => MONTHS.map((m, i) => (i === 3 || i === 8 ? { month: m, stays: 0, kwh: null, m3: null, kwh_per_stay: null, m3_per_stay: null, kwh_per_day: null, m3_per_day: null }
  : { month: m, stays: 4, kwh: (15 + i) * 4, m3: 2, kwh_per_stay: 15 + i, m3_per_stay: 0.5, kwh_per_day: 5, m3_per_day: 0.2 }));
// per_stay: the last 8 counted readings, oldest first; the last one is Oct 7, 25 kWh over 3 days
const perStay = () => [[30, 3], [20, 2], [40, 4], [10, 1], [24, 3], [18, 2], [36, 4], [25, 3]].map((v, i) => ({ checkout_date: '2026-09-' + String(20 + i).padStart(2, '0'), recorded_at: '2026-09-' + String(20 + i).padStart(2, '0') + 'T04:00:00Z', days: v[1], kwh: v[0], kwh_per_day: Math.round(v[0] / v[1] * 10) / 10, m3: v[1] * 0.3, m3_per_day: 0.3 }));
const UTIL = (u) => Object.assign({ kwh_month: 79, kwh_per_day: 9.9, m3_month: 3.1, m3_per_day: 0.39, nights_booked: 12, nights_in_month: 30,
  last_reading: { recorded_at: '2026-11-07T02:00:00Z', delta_kwh: 25, days: 3, kwh_per_day: 8.3, delta_m3: 0.9, m3_per_day: 0.3, flag: null },
  per_stay: perStay(), per_month: perMonth(), brownouts: { count: 0, hours: 0 }, water_cuts: { count: 0, hours: 0 } }, u || {});
const TARGET = (t) => Object.assign({ net_target: 30000, costs_basis: 24100, revenue_needed: 54100, adr: 2814, nights_in_month: 30, nights_on_books: 22, needed_occupancy: 0.641, needed_adr: 2459.09, set_by: null, set_at: '2026-11-02T03:00:00Z' }, t || {});
const payload = (u, admin) => Object.assign({ ok: true, month: '2026-10-01', utility: UTIL(u), inventory: {} }, admin ? { admin: Object.assign({ rate: null, occupancy: 0.4, sold_nights: 12, sellable_nights: 30, adr: 1880, target: TARGET() }, admin === true ? {} : admin) } : {});
function mountWith(data, role = 'cleaner', rpc) {
  const zoom = []; const win = { ICON: () => '', document: {}, CSZoom: { open: (src, o) => zoom.push([src, o]) } }; win.window = win; vm.runInContext(read('kpi/K_kpi.js'), vm.createContext(win));
  const L = {}, calls = [], el = { innerHTML: '', addEventListener: (t, f) => { (L[t] ||= []).push(f); }, removeEventListener() {}, querySelector: () => null };
  const client = { rpc: (n, a) => { calls.push([n, JSON.parse(JSON.stringify(a))]); return Promise.resolve(rpc && rpc[n] ? rpc[n](a) : n === 'kpi_tab_v1' ? { data, error: null } : n === 'admin_report_blocks_v1' ? { data: [], error: null } : { data: { ok: true }, error: null }); },
    storage: { from: () => ({ createSignedUrls: (paths) => Promise.resolve({ data: paths.map((p) => ({ path: p, signedUrl: 'https://signed.example/' + p })) }) }) } };
  win.K_Kpi.mount(el, { client, role, propertyId: 'p' });
  const fire = async (type, attrs, extra) => { const t = Object.assign({ getAttribute: (n) => attrs[n] ?? null, closest: () => t }, extra || {}); for (const f of L[type] || []) f({ target: t, preventDefault() {} }); await tick(); };
  return { win, el, calls, zoom, click: (attrs) => fire('click', attrs), input: (id, value) => fire('input', {}, { id, value }), submit: (attrs) => fire('submit', attrs) };
}
const cardOf = (h, id) => { const i = h.indexOf('id="' + id + '"'); assert.ok(i > 0, id + ' is drawn'); const rest = h.slice(i); const j = rest.indexOf('<div class="card glass', 10); return j > 0 ? rest.slice(0, j) : rest; };

// ---------------------------------------------------------------------------------------------- the chart standard
// s113 superseded the s111 bar charts (scale, chart 1, chart 2, r3 L3 labels): tests/s113-kpi-overhaul.test.mjs covers the line charts.
test('s111 utility tiles (s113 shape): per day, never per night; nights booked from the calendar with the month; the last reading over its days', async () => {
  for (const role of ['cleaner', 'laundry', 'owner']) {
    const { el, click } = mountWith(payload({}, role === 'owner'), role); await tick();
    const h = el.innerHTML;
    assert.match(h, /id="K_tE"><span class="K_lab">Electricity<\/span><span class="KU_big"><b>9\.9<\/b><span>kWh a day<\/span><\/span><span class="K_sub">79 kWh used this month<\/span>/);
    assert.match(h, /id="K_tW"><span class="K_lab">Water<\/span><span class="KU_big"><b>0\.39<\/b><span>m³ a day<\/span><\/span><span class="K_sub">3\.1 m³ used this month<\/span>/);
    assert.match(h, /id="K_tN"><span class="K_lab">Nights booked<\/span>[\s\S]*?<b>40%<\/b><\/span><span class="K_sub">12 of 30 nights<\/span>/, '12 / 30 = 40%, the Admin occupancy figure');
    assert.match(h, /id="K_last"><span class="K_lab">Last reading<\/span><span class="KU_big"><b>7 Nov<\/b><\/span><span class="K_sub">25 kWh over 3 days<\/span><span class="K_sub">8\.3 kWh a day<\/span><span class="K_sub">0\.9 m³ over 3 days · 0\.3 m³ a day<\/span>/);
    assert.doesNotMatch(h, /per night|a night/i, role + ': no per-night wording on Utility');
    if (role === 'owner') { await click({ 'data-kact': 'seg', 'data-seg': 'admin' }); assert.doesNotMatch(el.innerHTML, /per night/i, 'none on Admin either'); }
    await click({ 'data-kact': 'seg', 'data-seg': 'inventory' }); assert.doesNotMatch(el.innerHTML, /per night/i);
  }
  assert.doesNotMatch(read('kpi/K_kpi.js'), /per night|kwh_per_night|m3_per_night|nights_month/, 'the removed keys are not read');
  const empty = mountWith(payload({ kwh_per_day: null, nights_booked: null, per_stay: [], per_month: [] })); await tick();
  assert.match(empty.el.innerHTML, /A day figure needs two readings/); assert.match(empty.el.innerHTML, /Nights booked<\/span><span class="KU_big"><b>Not yet/); assert.doesNotMatch(empty.el.innerHTML, /K_day|K_avg/);
});

// ---------------------------------------------------------------------------------------------- Target card
test('s111 Target card: under Average rate, the server figures in plain words, the basis line; owner and admin set it, finance reads, staff never see it', async () => {
  const o = mountWith(payload({}, true), 'owner'); await tick(); await o.click({ 'data-kact': 'seg', 'data-seg': 'admin' });
  const h = o.el.innerHTML; assert.ok(h.indexOf('Average rate') < h.indexOf('id="K_target"'), 'below Average rate');
  const c = cardOf(h, 'K_target');
  assert.match(c, /Target this month<\/span><span class="K_val">₱30,000 net<\/span>/);
  assert.match(c, /To reach ₱54,100 in revenue this month \(₱24,100 costs \+ ₱30,000 target\): about 64% occupancy at ₱2,814 a night before Airbnb fees, or ₱2,459 a night for the 22 nights already booked\./);
  assert.match(c, /Costs basis: average of the last 3 months, ₱24,100\./); assert.match(c, /data-kact="tgt-open"/); assert.doesNotMatch(c, /!/);
  const f = mountWith(payload({}, true), 'finance'); await tick(); await f.click({ 'data-kact': 'seg', 'data-seg': 'admin' });
  assert.match(f.el.innerHTML, /id="K_target"/); assert.doesNotMatch(f.el.innerHTML, /tgt-open|Set target/, 'finance reads only');
  for (const role of ['cleaner', 'inspector', 'laundry', 'maintenance']) {
    const s = mountWith(payload({}, true), role); await tick(); await s.click({ 'data-kact': 'seg', 'data-seg': 'admin' });
    assert.doesNotMatch(s.el.innerHTML, /K_target|Target|₱|54,100/, role + ': the admin key is dropped before drawing');
  }
});

test('s111 Target card: break-even default, nulls read Not enough data yet, more than the month has', async () => {
  const be = mountWith(payload({}, { target: TARGET({ net_target: 0, revenue_needed: 24100, needed_occupancy: 0.286, needed_adr: 1095.45 }) }), 'admin'); await tick(); await be.click({ 'data-kact': 'seg', 'data-seg': 'admin' });
  assert.match(be.el.innerHTML, /<span class="K_val">Break-even<\/span>/); assert.match(be.el.innerHTML, /about 29% occupancy at ₱2,814 a night before Airbnb fees, or ₱1,095 a night for the 22 nights already booked/);
  const none = mountWith(payload({}, { target: TARGET({ costs_basis: null, revenue_needed: null, needed_occupancy: null, needed_adr: null }) }), 'owner'); await tick(); await none.click({ 'data-kact': 'seg', 'data-seg': 'admin' });
  assert.match(none.el.innerHTML, /<p class="K_p">Not enough data yet\.<\/p><p class="K_sub">Costs basis: not enough data yet\.<\/p>/);
  const noadr = mountWith(payload({}, { target: TARGET({ adr: null, needed_occupancy: null, nights_on_books: 0, needed_adr: null }) }), 'owner'); await tick(); await noadr.click({ 'data-kact': 'seg', 'data-seg': 'admin' });
  assert.match(noadr.el.innerHTML, /To reach ₱54,100 in revenue this month \(₱24,100 costs \+ ₱30,000 target\): occupancy: not enough data yet, or a rate for the booked nights: not enough data yet\./);
  const over = mountWith(payload({}, { target: TARGET({ needed_occupancy: 1.4 }) }), 'owner'); await tick(); await over.click({ 'data-kact': 'seg', 'data-seg': 'admin' });
  assert.match(over.el.innerHTML, /more nights than the month has at ₱2,814 a night/);
});

test('s111 Set target: number input in pesos, calm validation 0..10,000,000 before the server, kpi_target_set_v1 with the property, reload after save, server refusals in plain words', async () => {
  const win = { ICON: () => '' }; win.window = win; vm.runInContext(read('kpi/K_kpi.js'), vm.createContext(win)); const K = win.K_Kpi.lib;
  for (const bad of ['', 'abc', '-1', '10000001', null]) assert.match(K.targetProblem(bad), /from 0 to 10,000,000 pesos/, String(bad));
  for (const ok of ['0', '30000', '₱30,000', '10000000']) assert.equal(K.targetProblem(ok), null, ok);
  assert.deepEqual(JSON.parse(JSON.stringify(K.targetCall('p1', '₱30,000'))), { fn: 'kpi_target_set_v1', args: { p_property_id: 'p1', p_monthly_net_target: 30000 } });
  const o = mountWith(payload({}, true), 'owner'); await tick(); await o.click({ 'data-kact': 'seg', 'data-seg': 'admin' });
  await o.click({ 'data-kact': 'tgt-open' }); assert.match(o.el.innerHTML, /<label for="K_f_tgt">Monthly net target, pesos<\/label>[\s\S]*value="30000"/); assert.match(o.el.innerHTML, /0 means break-even/);
  await o.input('K_f_tgt', '-5'); await o.submit({ 'data-kform': 'tgt' });
  assert.equal(o.calls.filter((c) => c[0] === 'kpi_target_set_v1').length, 0, 'refused before the server'); assert.match(o.el.innerHTML, /role="alert">Enter an amount from 0 to 10,000,000 pesos/);
  await o.input('K_f_tgt', '45,000'); await o.submit({ 'data-kform': 'tgt' });
  assert.deepEqual(o.calls.filter((c) => c[0] === 'kpi_target_set_v1'), [['kpi_target_set_v1', { p_property_id: 'p', p_monthly_net_target: 45000 }]]);
  assert.equal(o.calls.filter((c) => c[0] === 'kpi_tab_v1').length, 2, 'the figures reload'); assert.match(o.el.innerHTML, /Target saved\./);
  const r = mountWith(payload({}, true), 'admin', { kpi_target_set_v1: () => ({ data: { ok: false, error: 'invalid_target' }, error: null }) }); await tick(); await r.click({ 'data-kact': 'seg', 'data-seg': 'admin' });
  await r.click({ 'data-kact': 'tgt-open' }); await r.input('K_f_tgt', '100'); await r.submit({ 'data-kform': 'tgt' }); assert.match(r.el.innerHTML, /That amount is not in range\. Check the number\./);
  const f = mountWith(payload({}, true), 'finance'); await tick(); await f.click({ 'data-kact': 'seg', 'data-seg': 'admin' }); await f.click({ 'data-kact': 'tgt-open' }); await f.submit({ 'data-kform': 'tgt' });
  assert.equal(f.calls.filter((c) => c[0] === 'kpi_target_set_v1').length, 0, 'finance cannot open or send the form');
});

// ---------------------------------------------------------------------------------------------- photo zoom
test('s111 zoom maths: 1..5, step 1.5x, double-tap 1 <-> 2.5, the point under the finger stays put, pan limited to the overflow', () => {
  assert.equal(CS.zoomClamp(0.4), 1); assert.equal(CS.zoomClamp(9), 5); assert.equal(CS.zoomClamp(NaN), 1); assert.equal(CS.ZOOM_MAX, 5);
  assert.equal(CS.zoomStep(1, 1), 1.5); assert.equal(CS.zoomStep(4, 1), 5); assert.equal(CS.zoomStep(1.5, -1), 1); assert.equal(CS.zoomStep(1, -1), 1);
  assert.equal(CS.zoomToggle(1), 2.5); assert.equal(CS.zoomToggle(2.5), 1); assert.equal(CS.zoomToggle(5), 1);
  // zoom 2x around a point 50 px right of centre in a 300 x 400 box: x = 50 - (50 - 0) * 2 = -50; within the 150 px overflow
  assert.deepEqual(CS.zoomAt({ s: 1, x: 0, y: 0 }, 2, 50, 0, 300, 400), { s: 2, x: -50, y: 0 });
  assert.deepEqual(CS.zoomAt({ s: 1, x: 0, y: 0 }, 2, 200, 0, 300, 400), { s: 2, x: -150, y: 0 }, 'clamped to (2 - 1) * 300 / 2');
  assert.deepEqual(CS.zoomAt({ s: 3, x: 120, y: -80 }, 1, 10, 10, 300, 400), { s: 1, x: 0, y: 0 }, 'back to 1x recentres');
  assert.deepEqual(CS.zoomPan({ s: 1, x: 40, y: 40 }, 300, 400), { s: 1, x: 0, y: 0 }, 'no pan at 1x');
});

function overlay() {
  const L = {}, attrs = {}, cls = new Set(); const sub = (o) => Object.assign({ style: {}, classList: { toggle: (c, on) => { (o._c ||= new Set())[on ? 'add' : 'delete'](c); } } }, o);
  const parts = { pan: sub({}), lvl: { textContent: '' }, zin: { disabled: false }, zout: { disabled: false }, img: {}, close: { focus() { parts.focused = 'close'; } }, box: { getBoundingClientRect: () => ({ width: 300, height: 400, left: 0, top: 0 }) } };
  const o = { innerHTML: '', style: {}, setAttribute: (k, v) => { attrs[k] = String(v); }, getAttribute: (k) => (k in attrs ? attrs[k] : null), removeAttribute: (k) => { delete attrs[k]; },
    classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c), toggle() {} }, addEventListener: (t, f) => { (L[t] ||= []).push(f); },
    querySelector: (q) => ({ '.Z_pan': parts.pan, '.Z_lvl': parts.lvl, '[data-act="z-in"]': parts.zin, '[data-act="z-out"]': parts.zout, img: parts.img, 'button[data-act="id-full-close"]': parts.close, '.Z_box': parts.box })[q] || null };
  const inBox = { closest: (s) => (s === '.Z_box' ? parts.box : null) };
  const ev = (t, e) => { for (const f of L[t] || []) f(Object.assign({ target: inBox, preventDefault() {} }, e)); };
  return { o, L, parts, ev };
}
test('s111 zoom viewer: opens with focus on Close, +/- buttons and keys, max 5x, double-tap, pinch, drag, Esc closes and focus returns to the opener; no long-press menu', async () => {
  let win; const ov = overlay(); const app = await boot({ role: 'owner', hash: '#home', handlers: baseHandlers('owner'), els: { H_idfull: ov.o }, winInit: (w) => { win = w; } });
  const opener = { focused: 0, focus() { this.focused++; } };
  win.CSZoom.open('https://signed.example/e.jpg', { alt: 'Electric meter photo', opener });
  assert.equal(ov.o.getAttribute('aria-label'), 'Electric meter photo'); assert.equal(ov.parts.focused, 'close'); assert.equal(ov.parts.img.src, 'https://signed.example/e.jpg');
  assert.match(ov.o.innerHTML, /data-act="z-out" aria-label="Zoom out"[\s\S]*data-act="z-in" aria-label="Zoom in"[\s\S]*data-act="id-full-close"/); assert.doesNotMatch(ov.o.innerHTML, /id-rot|download|href=/, 'a meter photo has no Rotate, no link');
  assert.equal(ov.parts.zout.disabled, true, 'nothing to zoom out of at 100%');
  await app.click({ 'data-act': 'z-in' }); assert.equal(win.CSZoom.state().s, 1.5); assert.equal(ov.parts.lvl.textContent, '150%'); assert.match(ov.parts.pan.style.transform, /scale\(1\.5\)/);
  for (let i = 0; i < 6; i++) await app.click({ 'data-act': 'z-in' }); assert.equal(win.CSZoom.state().s, 5, 'max 5x'); assert.equal(ov.parts.zin.disabled, true);
  for (const fn of app.listeners.keydown) fn({ key: '-', preventDefault() {} }); assert.equal(Math.round(win.CSZoom.state().s * 100) / 100, 3.33, 'minus key');
  await app.click({ 'data-act': 'z-out' }); await app.click({ 'data-act': 'z-out' }); await app.click({ 'data-act': 'z-out' }); assert.equal(win.CSZoom.state().s, 1);
  // double-tap (touch) at the centre: 2.5x, again: back to 1x
  const tapAt = (t) => { ov.ev('pointerdown', { pointerId: 1, clientX: 150, clientY: 200, pointerType: 'touch' }); ov.ev('pointerup', { type: 'pointerup', pointerId: 1, clientX: 150, clientY: 200, pointerType: 'touch', timeStamp: t }); };
  tapAt(1000); tapAt(1200); assert.equal(win.CSZoom.state().s, 2.5, 'double-tap zooms 2.5x'); tapAt(3000); tapAt(3150); assert.equal(win.CSZoom.state().s, 1, 'and back');
  ov.ev('dblclick', { clientX: 150, clientY: 200, timeStamp: 5000 }); assert.equal(win.CSZoom.state().s, 2.5, 'double-click with a mouse');
  // drag at 2.5x moves the photo, limited to (2.5 - 1) * 300 / 2 = 225 px
  ov.ev('pointerdown', { pointerId: 2, clientX: 100, clientY: 100, pointerType: 'touch' }); ov.ev('pointermove', { pointerId: 2, clientX: 400, clientY: 130 }); ov.ev('pointerup', { type: 'pointerup', pointerId: 2, clientX: 400, clientY: 130, pointerType: 'touch', timeStamp: 9000 });
  assert.deepEqual(JSON.parse(JSON.stringify(win.CSZoom.state())), { s: 2.5, x: 225, y: 30, open: true });
  ov.ev('dblclick', { clientX: 150, clientY: 200, timeStamp: 12000 }); assert.equal(win.CSZoom.state().s, 1);
  // pinch: two fingers 100 px apart spread to 300 px -> 3x
  ov.ev('pointerdown', { pointerId: 5, clientX: 100, clientY: 200 }); ov.ev('pointerdown', { pointerId: 6, clientX: 200, clientY: 200 }); ov.ev('pointermove', { pointerId: 6, clientX: 400, clientY: 200 });
  assert.equal(win.CSZoom.state().s, 3, 'pinch'); ov.ev('pointerup', { type: 'pointerup', pointerId: 5 }); ov.ev('pointerup', { type: 'pointerup', pointerId: 6 });
  let blocked = 0; for (const f of ov.L.contextmenu) f({ preventDefault: () => { blocked++; } }); assert.equal(blocked, 1, 'the hold menu (save, share) is blocked');
  for (const fn of app.listeners.keydown) fn({ key: 'Escape' }); assert.equal(win.CSZoom.state().open, false); assert.equal(opener.focused, 1, 'focus returns to the opener');
});

test('s111 zoom viewer: the ID full view uses it and keeps Rotate and its rules; reduced motion drops the animation; meter photos and the receipt open it', async () => {
  let win; const ov = overlay(); await boot({ role: 'owner', hash: '#home', reduced: true, handlers: baseHandlers('owner'), els: { H_idfull: ov.o }, winInit: (w) => { win = w; } });
  win.CSZoom.open('blob:id', { alt: 'Guest ID photo', rotate: true }); assert.match(ov.o.innerHTML, /data-act="id-rot">Rotate/); assert.equal(ov.o.getAttribute('data-zoom'), 'id');
  win.CSZoom.step(1); assert.equal((ov.parts.pan._c || new Set()).has('Z_anim'), false, 'reduced motion: no zoom animation');
  const src = read('app.js'); assert.match(src, /function H_idFull\(src\) \{ Z_open\(src, \{ alt: 'Guest ID photo', rotate: true \}\); \}/);
  assert.doesNotMatch(src.slice(src.indexOf('function H_idFull'), src.indexOf('function H_idClose')), /download|href=|navigator\.share|share/i);
  assert.match(read('styles.css'), /\.Z_box \{[^}]*touch-action: none;[^}]*-webkit-touch-callout: none;/); assert.match(read('styles.css'), /@media \(prefers-reduced-motion: reduce\) \{ \.Z_pan\.Z_anim \{ transition: none; \} \}/);
  // meter check photo: a button around the signed picture opens the viewer with that URL
  const k = mountWith(payload({}, true), 'owner', { admin_report_blocks_v1: () => ({ data: [{ reading_id: 'r1', typed_electric: 10, typed_water: 2, photo_path_electric: 'm/e.jpg', photo_path_water: null }], error: null }) }); await tick(); await k.click({ 'data-kact': 'seg', 'data-seg': 'admin' }); await tick();
  assert.match(k.el.innerHTML, /<button class="K_phb" type="button" data-kact="zoom" data-path="m\/e\.jpg" data-alt="Electric meter photo" aria-label="Zoom the electric meter photo"><img src="https:\/\/signed\.example\/m\/e\.jpg"/);
  const opener = { x: 1 }; await k.click({ 'data-kact': 'zoom', 'data-path': 'm/e.jpg', 'data-alt': 'Electric meter photo' });
  assert.equal(k.zoom.length, 1); assert.equal(k.zoom[0][0], 'https://signed.example/m/e.jpg'); assert.equal(k.zoom[0][1].alt, 'Electric meter photo'); void opener;
  const sup = read('stock/S110_supply.js'); assert.match(sup, /data-sact="rcpt-zoom" aria-label="Zoom the receipt photo"/); assert.match(sup, /root\.CSZoom\.open\(S\.rcpt, \{ alt: 'The receipt photo', opener: t \}\)/); assert.match(sup, /relRcpt\(S\); S\.dead = true/, 'the in-memory receipt is released on leave');
});

// ---------------------------------------------------------------------------------------------- Guest tiers card
test('s111 Guest tiers: thresholds, glyphs, every perk per tier (arrival and house), no prices, no ID line', () => {
  const g = CS.tierGuide();
  assert.deepEqual(g.map((t) => [t.tier, t.word, t.icon, t.rule]), [['first', 'First stay', 'sprout', '1st stay. The standard amenities.'], ['returning', 'Returning', 'repeat', 'From the 2nd stay.'], ['regular', 'Regular', 'sparkles', '4 or more stays, or 10 or more nights.'], ['vip', 'VIP', 'crown', '7 or more stays, or 20 or more nights.']]);
  assert.deepEqual(g[0].perks, [], 'a first stay gets the standard amenities, no perks (D-360)');
  assert.deepEqual(g[1].perks, ['Returning-guest freebie: 2 Kit Kats or an extra bottle of water', 'First hour of early check-in or late check-out free, if the calendar allows']);
  assert.deepEqual(g[2].perks, ['Returning-guest freebie: 2 Kit Kats or an extra bottle of water', 'Up to 2 hours early or late free, if the calendar allows', 'Set saved preferences before arrival (pillows, AC temperature)']);
  assert.deepEqual(g[3].perks, ['Returning-guest freebie: 2 Kit Kats or an extra bottle of water', 'Up to 2 hours early or late free, if the calendar allows', 'Set saved preferences before arrival (pillows, AC temperature)', 'Handwritten welcome note', 'Mid-stay refresh, any stay length', 'First call on the dates they ask about']);
  assert.doesNotMatch(JSON.stringify(g), /₱|PHP|price|discount|!|No need to ask for ID/);
});
test('s111 Guest tiers (s114 shape): a card after the guest cards on Today, closed until tapped, the same for every role, with the tier badge styles', async () => {
  for (const role of ['cleaner', 'laundry', 'owner']) {
    const h = (await boot({ role, hash: '#home', handlers: baseHandlers(role) })).els['v-home'].innerHTML;
    const m = /<details class="card glass A_card F_span T_tiers" id="T_tiers"><summary class="T_tsum">[\s\S]*?<span>Guest tiers: how many stays for each<\/span>[\s\S]*?<\/details>/.exec(h); assert.ok(m, role + ' closed by default');
    for (const t of ['first', 'returning', 'regular', 'vip']) assert.match(m[0], new RegExp('<span class="T_badge p-tier-' + t + '"><svg[^>]*data-i="[a-z]+"'), role + ' ' + t);
    assert.match(m[0], /7 stays or 20 nights[\s\S]*Handwritten welcome note/); assert.doesNotMatch(m[0], /₱/);
    assert.ok(h.indexOf('T_tiers') > h.indexOf("S_sec") && (h.indexOf('Turnover') < 0 || h.indexOf('T_tiers') < h.indexOf('>Turnover<')), 'right after the guest cards');
  }
});

test('s111 release pins and tokens: version unchanged, chart tokens in all three theme blocks, no raw colours or px type in the new CSS', () => {
  assert.equal(JSON.parse(read('package.json')).version, '3.4.29'); assert.match(read('sw.js'), /CACHE_NAME = 'cs-shell-v54'/);
  const tok = read('tokens.css'); for (const k of ['chart-line', 'chart-area', 'chart-band', 'chart-grid', 'chart-axis', 'chart-avg']) assert.equal((tok.match(new RegExp('--v5-' + k + ':', 'g')) || []).length, 3, k);
  const css = read('kpi/K_kpi.css'); const s111 = css.slice(css.indexOf('s113, the chart standard'), css.indexOf('/* supply and consumption'));
  assert.doesNotMatch(s111, /#[0-9a-f]{3,6}\b|rgb\(|nowrap|font-size:\s*\d+px|font:[^;]*\d+px/i);
  const sty = read('styles.css'); const z = sty.slice(sty.indexOf('s111: the shared zoom viewer'), sty.indexOf('s111: the shared zoom viewer') + 900); assert.doesNotMatch(z, /#[0-9a-f]{3,6}\b|rgb\(|nowrap/i);
  const d = createDemo(); assert.equal(d.utility.nights_booked, d.admin.sold_nights, 'demo: nights booked equals the Admin occupancy nights'); assert.ok(!('kwh_per_night' in d.utility) && !('nights_month' in d.utility));
});
function createDemo() { const src = read('demo.js'); const m = /function kpiFixture\(r, today\) \{[\s\S]*?\n  \}\n/.exec(src); const fn = new Function('CS', m[0] + '; return kpiFixture;')(CS); return fn('owner', '2026-10-15'); }

// ---------------------------------------------------------------------------------------------- fix round r3 (M3, L2, L3)
test('s111 r3 M3: the zoom viewer keeps Tab and Shift+Tab on its own buttons (disabled skipped), and Esc closes only the viewer, not the sheet under it', async () => {
  let win, active = null; const ov = overlay();
  const btn = (n, dis) => ({ n, disabled: !!dis, focus() { active = this; } });
  const bs = [btn('z-out', true), btn('z-in'), btn('rot'), btn('close')]; ov.o.querySelectorAll = (q) => (q === 'button' ? bs : []);
  const app = await boot({ role: 'owner', hash: '#home', handlers: baseHandlers('owner'), els: { H_idfull: ov.o }, winInit: (w) => { win = w; }, activeEl: () => active });
  const key = (k, shift) => { let stopped = 0; for (const fn of app.listeners.keydown) fn({ key: k, shiftKey: !!shift, preventDefault: () => { stopped++; } }); return stopped; };
  win.CSZoom.open('blob:id', { alt: 'Guest ID photo', rotate: true });
  active = bs[3]; assert.equal(key('Tab'), 1); assert.equal(active.n, 'z-in', 'Tab on the last button wraps to the first enabled one');
  assert.equal(key('Tab', true), 1); assert.equal(active.n, 'close', 'Shift+Tab on the first wraps to the last');
  active = bs[1]; assert.equal(key('Tab'), 0, 'in the middle the browser moves focus as usual');
  active = null; assert.equal(key('Tab'), 1); assert.equal(active.n, 'z-in', 'focus outside the viewer comes back in');
  const src = read('app.js'); assert.match(src, /if \(ev\.key === 'Escape'\) \{ if \(Z_isOpen\(\)\) \{ H_idClose\(\); return; \}/, 'Esc with the viewer open closes only the viewer');
  await app.click({ 'data-act': 'pc-open' }); await app.flush(); assert.equal(app.els['pc-sheet'].hidden, false, 'a sheet under the viewer');
  win.CSZoom.open('blob:id', { alt: 'Guest ID photo', rotate: true }); key('Escape'); assert.equal(win.CSZoom.state().open, false); assert.equal(app.els['pc-sheet'].hidden, false, 'the sheet stays');
  key('Escape'); assert.equal(app.els['pc-sheet'].hidden, true, 'the next Esc closes the sheet');
  win.CSZoom.close(); active = null; assert.equal(key('Tab'), 0, 'closed: Tab is left alone');
});

test('s111 r3 L2: the Target line shows the sum (costs + target), the average rate is before Airbnb fees, centavos up to 2 dp are sent as typed, never rounded', async () => {
  const win = { ICON: () => '' }; win.window = win; vm.runInContext(read('kpi/K_kpi.js'), vm.createContext(win)); const K = win.K_Kpi.lib;
  const L = K.targetLines({ net: 30000.5, costs: 24100, need: 54100.5, adr: 2814, occ: 0.641, onBooks: 22, needAdr: 2459.09 });
  assert.match(L.line, /^To reach ₱54,101 in revenue this month \(₱24,100 costs \+ ₱30,001 target\): about 64% occupancy at ₱2,814 a night before Airbnb fees, or ₱2,459 a night for the 22 nights already booked\.$/);
  assert.match(K.targetLines({ net: 0, costs: 24100, need: 24100, adr: 2814, occ: 0.3, onBooks: 0 }).line, /\(₱24,100 costs \+ ₱0 target\)/, 'break-even shows a zero target');
  assert.deepEqual(JSON.parse(JSON.stringify(K.targetCall('p1', '₱30,000.50'))).args.p_monthly_net_target, 30000.5, 'kpi_target_set_v1 keeps 2 dp: sent as typed');
  assert.equal(K.targetProblem('30000.25'), null); assert.match(K.targetProblem('30000.255'), /up to 2 decimals/, 'more than 2 dp is refused here, not rounded (the server would refuse it)');
  assert.match(K.targetProblem('1e5'), /from 0 to 10,000,000 pesos/);
  const o = mountWith(payload({}, true), 'owner'); await tick(); await o.click({ 'data-kact': 'seg', 'data-seg': 'admin' }); await o.click({ 'data-kact': 'tgt-open' });
  assert.match(o.el.innerHTML, /<input id="K_f_tgt" inputmode="decimal"/); assert.match(o.el.innerHTML, /Centavos are kept, up to 2 decimals\./);
  await o.input('K_f_tgt', '45,000.75'); await o.submit({ 'data-kform': 'tgt' });
  assert.deepEqual(o.calls.filter((c) => c[0] === 'kpi_target_set_v1')[0][1].p_monthly_net_target, 45000.75);
  assert.doesNotMatch(read('kpi/K_kpi.js'), /p_monthly_net_target: Math\.round/);
});
