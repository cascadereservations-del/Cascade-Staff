// s135 (Staff 3.4.54): the "Guest guide" card on Manage > KPIs (manage/N_manage.js), from staff_guide_usage_v1(p_days 30).
// Same harness style as tests/N_manage.test.mjs: the module runs in a vm sandbox with a tiny fake element and a client that records every call.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(root, 'manage', 'N_manage.js'), 'utf8');
const CSS = fs.readFileSync(path.join(root, 'manage', 'N_manage.css'), 'utf8');
const NOW = Date.parse('2026-10-14T03:00:00Z');
const EVIL = '<img src=x onerror=alert(1)>';
const tick = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const plain = (x) => JSON.parse(JSON.stringify(x));

class FakeEl {
  constructor() { this.html = ''; this.l = {}; }
  set innerHTML(v) { this.html = String(v); }
  get innerHTML() { return this.html; }
  addEventListener(t, f) { (this.l[t] ||= []).push(f); }
  removeEventListener(t, f) { this.l[t] = (this.l[t] || []).filter((x) => x !== f); }
  querySelector() { return null; }
}
const METRICS = { propertyId: 'p', periodStart: 'x', periodEndExclusive: 'y', sourceAsOf: null, financeVisible: true, blockedNights: 0,
  metrics: { occupancy: { key: 'occupancy', value: '60', unit: 'percent', coverage: 'complete' }, sold_nights: { key: 'sold_nights', value: '14', unit: 'night', coverage: 'complete' } } };
const USAGE = (o = {}) => Object.assign({ since: '2026-09-15', devices: 14, verified_stays: 5, opens: 1241,
  by_day: [{ day: '2026-09-15', devices: 2, events: 4 }, { day: '2026-09-20', devices: 3, events: 9 }, { day: '2026-10-14', devices: 1, events: 2 }],
  sections: [{ section: 'wifi', views: 33, devices: 12, avg_seconds: 18 }, { section: 'checklist', views: 21, devices: 7, avg_seconds: 95 }, { section: 'house_rules', views: 12, devices: 9, avg_seconds: 41 },
    { section: 'nearby', views: 9, devices: 5, avg_seconds: 62 }, { section: 'delivery', views: 7, devices: 4, avg_seconds: 27 }, { section: 'contact', views: 2, devices: 2, avg_seconds: 8 }],
  top_taps: [{ target: 'map_open', section: 'nearby', taps: 9, devices: 4 }, { target: 'wifi_copy', section: 'wifi', taps: 24, devices: 11 }, { target: 'a', section: 'x', taps: 1, devices: 1 }, { target: 'b', section: 'x', taps: 2, devices: 1 },
    { target: 'c', section: 'x', taps: 3, devices: 1 }, { target: 'd', section: 'x', taps: 4, devices: 1 }],
  funnel: { verify_start: 9, verify_ok: 5, browse_guest: 7, checklist_done: 3, message_sent: 4 },
  searches_without_result: [{ target: 'jollibee', n: 3 }, { target: 'pizza', n: 2 }] }, o);

function boot({ usage, role = 'owner', sub = 'kpis', demo = false } = {}) {
  const win = {}, calls = [];
  const ctx = { window: win, localStorage: undefined, navigator: { onLine: true }, Intl, Date, Promise, JSON, Math, console, setTimeout, clearTimeout, Uint8Array, document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} }, history: { replaceState() {} } };
  vm.createContext(ctx); vm.runInContext(SRC, ctx, { filename: 'N_manage.js' });
  win.N_Manage._setClock(() => NOW);
  const client = demo ? undefined : {
    calls,
    rpc(name, args) {
      calls.push([name, plain(args || {})]);
      if (name === 'get_hospitality_metrics_v1') return Promise.resolve({ data: plain(METRICS), error: null });
      if (name === 'staff_guide_usage_v1' && usage) { const r = usage(args); return Promise.resolve(r && r.then ? r : plain(r)); }
      return Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.' + name } });
    }
  };
  const el = new FakeEl(), nav = [];
  win.N_Manage.mount(el, { client, demo, role, sub, navigate: (h) => nav.push(h), toast() {}, haptic() {} });
  return { M: win.N_Manage, el, calls, client, nav, html: () => el.innerHTML, ready: async () => { await tick(); return undefined; },
    click: async (act, v) => { const t = { getAttribute: (k) => ({ 'data-n': act, 'data-v': v === undefined ? null : v })[k] ?? null }; t.closest = (sel) => (sel === '[data-n]' ? t : null); for (const f of el.l.click || []) f({ target: t, preventDefault() {} }); await tick(); } };
}
const usageCalls = (t) => t.calls.filter((c) => c[0] === 'staff_guide_usage_v1');

test('s135 usage model: top five sections and taps, the five funnel steps in order, a dense 30 day line, plain-word timings', () => {
  const { M } = boot({ sub: 'today' }), G = M.lib.guestGuide;
  const m = plain(G.model(USAGE(), 30)); // out of the vm realm, so deepEqual compares plain objects
  assert.equal(m.devices, 14); assert.equal(m.verified, 5); assert.equal(m.opens, 1241); assert.equal(m.sent, 4);
  assert.deepEqual(m.sections.map((s) => s.label), ['Wifi', 'Checklist', 'House rules', 'Nearby', 'Delivery'], 'five, newest-biggest first, the sixth is cut');
  assert.deepEqual(m.sections.map((s) => s.avg), ['18 s', '1 min 35 s', '41 s', '1 min 2 s', '27 s']);
  assert.deepEqual(m.taps.map((t) => t.target), ['wifi_copy', 'map_open', 'd', 'c', 'b']);
  assert.deepEqual(m.taps.map((t) => t.label), ['Copied the wifi password', 'Opened a map', 'D', 'C', 'B']);
  assert.deepEqual(m.funnel.map((s) => s.key), ['verify_start', 'verify_ok', 'browse_guest', 'checklist_done', 'message_sent']);
  assert.deepEqual(m.funnel.map((s) => s.n), [9, 5, 7, 3, 4]);
  assert.equal(m.perDay.length, 30); assert.equal(m.perDay[0], 4); assert.equal(m.perDay[5], 9); assert.equal(m.perDay[29], 2); assert.equal(m.perDay[1], 0);
  assert.deepEqual(m.searches, [{ target: 'jollibee', n: 3 }, { target: 'pizza', n: 2 }]);
  assert.equal(m.empty, false);
  assert.equal(G.model(USAGE({ devices: 0, opens: 0, verified_stays: 0 })).empty, true);
  assert.equal(G.model(null), null); assert.equal(G.model([]), null);
  const odd = plain(G.model({ devices: 'x', opens: -3, sections: [null, { section: '', views: '4' }], top_taps: [{ taps: 3 }], funnel: null, by_day: 'nope', searches_without_result: [{ target: 't' }] }));
  assert.equal(odd.devices, 0); assert.equal(odd.opens, 0); assert.equal(odd.sections[0].label, 'Other'); assert.equal(odd.sections[0].views, 4); assert.equal(odd.taps.length, 0); assert.deepEqual(odd.perDay, []); assert.equal(odd.searches[0].n, 0);
  assert.equal(G.tapLabel('wifi_copy'), 'Copied the wifi password'); assert.equal(G.tapLabel('map_open'), 'Opened a map'); assert.equal(G.tapLabel('checklist_item'), 'Ticked a checklist item');
  assert.equal(G.tapLabel('call_host_now'), 'Call host now', 'unknown: cleaned, never the slug'); assert.equal(G.tapLabel('constructor'), 'Constructor'); assert.equal(G.tapLabel('x-y__z'), 'X y z');
  assert.equal(G.seconds(0), '0 s'); assert.equal(G.seconds(59.6), '1 min'); assert.equal(G.seconds(120), '2 min'); assert.equal(G.label('house_rules'), 'House rules'); assert.equal(G.DAYS, 30);
});
test('s135 usage rpc: the KPIs tab calls staff_guide_usage_v1 with exactly {p_days: 30}, once, and no other tab does', async () => {
  const t = boot({ usage: () => ({ data: USAGE(), error: null }) }); await t.ready();
  assert.deepEqual(usageCalls(t).map((c) => c[1]), [{ p_days: 30 }]);
  const t2 = boot({ sub: 'today', usage: () => ({ data: USAGE(), error: null }) }); await t2.ready();
  assert.equal(usageCalls(t2).length, 0, 'Today does not read it');
});
test('s135 usage card: devices, verified stays, opens, messages, sparkline, top sections with average time, top taps, funnel, empty searches', async () => {
  const t = boot({ usage: () => ({ data: USAGE(), error: null }) }); await t.ready();
  const h = t.html(), text = h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.match(h, /aria-labelledby="N_gg1"/); assert.match(text, /Guest guide/); assert.match(text, /The last 30 days/);
  assert.match(text, /Devices 14/); assert.match(text, /Verified stays 5/); assert.match(text, /Opens 1,241/); assert.match(text, /Messages sent 4/);
  assert.match(h, /<div class="N_ggspark">.*<svg class="N_spark"/s); assert.match(text, /Activity per day, from 15 Sep 2026/);
  assert.match(text, /Top sections/); assert.match(text, /Wifi 33 views · 18 s avg/); assert.match(text, /Checklist 21 views · 1 min 35 s avg/); assert.ok(!/Contact/.test(text), 'only five');
  assert.match(text, /Top taps/); assert.match(text, /Copied the wifi password 24 taps/, 'wifi is not said twice'); assert.match(text, /Opened a map Nearby 9 taps/); assert.ok(!/wifi_copy|map_open|checklist_item/.test(text), 'no raw slug');
  assert.match(text, /What guests do/); for (const w of ['Started verifying 9', 'Verified a stay 5', 'Browsed as a guest 7', 'Finished the checklist 3', 'Sent a message 4']) assert.match(text, new RegExp(w));
  assert.match(h, /N_ggbar" aria-hidden="true" style="--w:100%"/); assert.match(h, /style="--w:56%"/);
  assert.match(text, /Delivery searches with no result/); assert.match(text, /jollibee 3 times/); assert.match(text, /pizza 2 times/);
  assert.ok(h.indexOf('N_ggtiles') > h.indexOf('N_list'), 'the card follows the number rows');
});
test('s135 usage card: an empty month says so; it never draws a chart of nothing', async () => {
  const t = boot({ usage: () => ({ data: USAGE({ devices: 0, opens: 0, verified_stays: 0, by_day: [], sections: [], top_taps: [], searches_without_result: [] }), error: null }) }); await t.ready();
  assert.match(t.html(), /No guide visits in this time yet/); assert.ok(!/N_ggtiles|N_ggspark|Top sections/.test(t.html()));
});
test('s135 usage feature detect: a server without staff_guide_usage_v1 (PGRST202, 404) or an account without the right draws nothing at all', async () => {
  for (const [name, usage] of [['PGRST202', null], ['404', () => ({ data: null, error: { status: 404, message: 'Not Found' } })], ['refused', () => ({ data: null, error: { code: '42501', message: 'not authorised' } })]]) {
    const t = boot({ usage }); await t.ready();
    assert.equal(usageCalls(t).length, 1, name); assert.ok(!/Guest guide|N_gg|not available in this version|not allowed to see/.test(t.html()), name + ': ' + t.html().slice(0, 80));
    assert.match(t.html(), /N_list/, name + ': the rest of the KPIs still draw');
  }
});
test('s135 usage card: a dropped connection shows one plain line with Try again; Try again reads it once more', async () => {
  let n = 0; const t = boot({ usage: () => (++n === 1 ? { data: null, error: { message: 'Failed to fetch' } } : { data: USAGE(), error: null }) }); await t.ready();
  assert.match(t.html(), /The guest guide figures could not be loaded/); assert.match(t.html(), /data-n="retry" data-v="kpis"/);
  await t.click('retry', 'kpis'); assert.equal(usageCalls(t).length, 2); assert.match(t.html(), /Devices/); assert.ok(!/could not be loaded/.test(t.html()));
});
test('s135 usage card: guide names and search words are escaped, never HTML', async () => {
  const t = boot({ usage: () => ({ data: USAGE({ sections: [{ section: EVIL, views: 3, devices: 1, avg_seconds: 4 }], top_taps: [{ target: EVIL, section: EVIL, taps: 2, devices: 1 }], searches_without_result: [{ target: EVIL, n: 2 }] }), error: null }) }); await t.ready();
  assert.ok(!t.html().includes('<img')); assert.ok(t.html().includes('&lt;img src=x onerror=alert(1)&gt;'));
});
test('s135 usage demo: the demo shows a believable card with no client at all', async () => {
  const t = boot({ demo: true }); await t.ready();
  assert.match(t.html(), /Guest guide/); assert.match(t.html(), /Top sections/); assert.match(t.html(), /Devices/);
});
test('s135 usage card stays inside the owner and admin tab, and the stylesheet carries its rules', () => {
  for (const k of ['.N_gg ', '.N_ggtiles', '.N_ggbar', '.N_gglist', '.N_h4']) assert.ok(CSS.includes(k), k);
  assert.equal((CSS.match(/\{/g) || []).length, (CSS.match(/\}/g) || []).length);
  assert.doesNotMatch(CSS.slice(CSS.indexOf('s135 (3.4.54)')), /#[0-9a-fA-F]{3,8}\b/, 'tokens only, no raw colours');
  assert.match(SRC, /canManage\(S\.role\)\) load\('gg', force\)/);
});

test('s136 r1 card layout: only tiles, activity and funnel stay open; sections, taps and searches sit in ONE closed details with a 44 px summary', async () => {
  const t = boot({ usage: () => ({ data: USAGE(), error: null }) }); await t.ready();
  const h = t.html(), card = h.slice(h.indexOf('N_gg1')), d = card.match(/<details class="N_ggmore">(.*?)<\/details>/s);
  assert.ok(d, 'one details'); assert.equal((card.match(/<details/g) || []).length, 1); assert.ok(!/<details[^>]*open/.test(card), 'closed by default');
  assert.match(d[1], /<summary class="N_ggsum">More: sections, taps, searches<\/summary>/);
  for (const w of ['Top sections', 'Top taps', 'Delivery searches with no result']) { assert.ok(d[1].includes(w), w + ' inside'); assert.ok(!card.replace(d[0], '').includes(w), w + ' not outside'); }
  for (const w of ['N_ggtiles', 'N_ggspark', 'What guests do']) assert.ok(card.replace(d[0], '').includes(w), w + ' stays visible');
  assert.match(CSS, /\.N_ggsum \{[^}]*min-height: var\(--touch, 44px\)/);
  // height without a layout engine: count the rows that draw while closed (2 tiles rows, 1 activity block, 5 funnel rows) against the 560 px budget
  const closed = card.replace(d[0], ''), rows = { tiles: 2, funnel: (closed.match(/<li>/g) || []).length };
  const est = 16 * 2 + 28 /*h3*/ + 20 /*sub*/ + rows.tiles * 62 + 8 + 70 /*activity*/ + 24 /*h4*/ + rows.funnel * 28 + 44 /*summary*/ + 10 * 5 /*gaps*/;
  assert.equal(rows.funnel, 5); assert.ok(est <= 560, 'estimated closed height ' + est + ' px');
  const t2 = boot({ usage: () => ({ data: USAGE({ sections: [], top_taps: [], searches_without_result: [] }), error: null }) }); await t2.ready();
  assert.ok(!/N_ggmore/.test(t2.html()), 'nothing to fold, no details row');
});
test('s136 r1 card rows: labels never break inside a word (css), values wrap instead; the value is the short "views · time avg" form', () => {
  const row = CSS.match(/\.N_gglist > li \{[^}]*\}/)[0]; assert.match(row, /display: flex/); assert.match(row, /flex-wrap: wrap/);
  const lab = CSS.match(/^\.N_ggl \{[^}]*\}/m)[0]; assert.match(lab, /overflow-wrap: break-word/); assert.match(lab, /word-break: normal/); assert.doesNotMatch(lab, /anywhere|break-all/);
  assert.match(CSS, /\.N_gglist > li > \.N_ggv \{[^}]*flex: 0 1 auto/);
});
test('s136 r1 usage probe: a server without staff_guide_usage_v1 is probed once per session; refresh probes again; denied is unchanged; found clears it', async () => {
  const t = boot({ usage: null }); await t.ready();
  assert.equal(usageCalls(t).length, 1);
  t.M.mount(new FakeEl(), { client: t.client, demo: false, role: 'owner', sub: 'today', navigate() {}, toast() {}, haptic() {} }); await tick(); // a later visit in the same session
  t.M.mount(t.el, { client: t.client, demo: false, role: 'owner', sub: 'kpis', navigate() {}, toast() {}, haptic() {} }); await tick();
  assert.equal(usageCalls(t).length, 1, 'second KPI visit does not probe again'); assert.ok(!/N_gg1/.test(t.html()));
  await t.click('refresh'); assert.equal(usageCalls(t).length, 2, 'the person pressing Refresh probes again');
  t.M._resetGuideKnown(); t.M.mount(t.el, { client: t.client, demo: false, role: 'owner', sub: 'kpis', navigate() {}, toast() {}, haptic() {} }); await tick();
  assert.equal(usageCalls(t).length, 3, 'a reset (new session) probes again');
  const d = boot({ usage: () => ({ data: null, error: { code: '42501', message: 'x' } }) }); await d.ready();
  d.M.mount(d.el, { client: d.client, demo: false, role: 'owner', sub: 'kpis', navigate() {}, toast() {}, haptic() {} }); await tick();
  assert.equal(usageCalls(d).length, 2, 'denied is not cached: it still reads on each visit');
});
