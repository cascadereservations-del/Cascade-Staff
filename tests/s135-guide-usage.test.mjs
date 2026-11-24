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

function boot({ usage, guests, role = 'owner', sub = 'kpis', demo = false } = {}) {
  const win = {}, calls = [];
  const ctx = { window: win, localStorage: undefined, navigator: { onLine: true }, Intl, Date, Promise, JSON, Math, console, setTimeout, clearTimeout, Uint8Array, document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} }, history: { replaceState() {} } };
  vm.createContext(ctx); vm.runInContext(SRC, ctx, { filename: 'N_manage.js' });
  win.N_Manage._setClock(() => NOW);
  const client = demo ? undefined : {
    calls,
    rpc(name, args) {
      calls.push([name, plain(args || {})]);
      if (name === 'get_hospitality_metrics_v1') return Promise.resolve({ data: plain(METRICS), error: null });
      if (name === 'staff_guide_guests_v1' && guests) { const r = guests(args); return Promise.resolve(r && r.then ? r : plain(r)); }
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
  assert.deepEqual(m.funnel.map((s) => s.key), ['verify_start', 'verify_ok', 'checklist_done']);
  assert.deepEqual(m.funnel.map((s) => s.n), [9, 5, 3]); assert.deepEqual(m.side.map((s) => [s.key, s.n]), [['browse_guest', 7], ['message_sent', 4]]);
  assert.equal(m.perDay.length, 30); assert.equal(m.perDay[0], 4); assert.equal(m.perDay[5], 9); assert.equal(m.perDay[29], 2); assert.equal(m.perDay[1], 0); // the window is the 30 Manila days ending 2026-10-14 (Manila today at the frozen clock)
  assert.deepEqual(m.searches, [{ target: 'jollibee', n: 3 }, { target: 'pizza', n: 2 }]);
  assert.equal(m.empty, false);
  assert.equal(G.model(USAGE({ devices: 0, opens: 0, verified_stays: 0 })).empty, true);
  assert.equal(G.model(null), null); assert.equal(G.model([]), null);
  const odd = plain(G.model({ devices: 'x', opens: -3, sections: [null, { section: '', views: '4' }], top_taps: [{ taps: 3 }], funnel: null, by_day: 'nope', searches_without_result: [{ target: 't' }] }));
  assert.equal(odd.devices, 0); assert.equal(odd.opens, 0); assert.equal(odd.sections[0].label, 'Other'); assert.equal(odd.sections[0].views, 4); assert.equal(odd.taps.length, 0); assert.equal(odd.perDay.length, 30); assert.ok(odd.perDay.every((v) => v === 0)); assert.equal(odd.searches[0].n, 0);
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
  assert.match(h, /aria-labelledby="N_gg1"/); assert.match(text, /Guest guide/); assert.match(text, /Last 30 days\./); assert.ok(!/The last 30 days/.test(text));
  assert.match(text, /Devices 14/); assert.match(text, /Opens 1,241/); assert.ok(!/Verified stays|Messages sent/.test(text));
  assert.match(h, /<div class="N_row N_static N_kpi"><span class="N_rowmid"><span class="N_rowt">Devices<\/span><\/span><span class="N_val N_num">14<\/span><\/div>/); assert.equal((h.slice(h.indexOf('N_gg1')).match(/N_row N_static N_kpi/g) || []).length, 2);
  assert.match(h, /<div class="N_ggspark">.*<svg class="N_spark"/s); assert.match(text, /Guide actions per day\. 15 in all\./); assert.ok(!/from 15 Sep/.test(text));
  assert.match(text, /Top sections/); assert.match(text, /Wifi 33 views · 18 s avg/); assert.match(text, /Checklist 21 views · 1 min 35 s avg/); assert.ok(!/Contact/.test(text), 'only five');
  assert.match(text, /Top taps/); assert.match(text, /Copied the wifi password 24 taps/, 'wifi is not said twice'); assert.match(text, /Opened a map Nearby 9 taps/); assert.ok(!/wifi_copy|map_open|checklist_item/.test(text), 'no raw slug');
  assert.match(text, /What guests do/); for (const w of ['Started verifying 9', 'Verified a stay 5', 'Finished the checklist 3', 'Browsed without verifying 7', 'Sent a message 4']) assert.match(text, new RegExp(w));
  assert.match(h, /N_ggbar" aria-hidden="true" style="--w:100%"/); assert.match(h, /style="--w:56%"/); assert.match(h, /style="--w:33%"/);
  const fun = h.match(/<ol class="N_ggfun">(.*?)<\/ol>/s)[1], side = h.match(/<\/ol><ul class="N_gglist">(.*?)<\/ul>/s)[1];
  assert.equal((fun.match(/<li>/g) || []).length, 3); assert.ok(!/Browsed|Sent a message/.test(fun), 'only the real ordered steps carry bars'); assert.ok(/Browsed without verifying/.test(side) && /Sent a message/.test(side) && !/N_ggbar/.test(side));
  assert.match(text, /Delivery searches with no result/); assert.match(text, /jollibee 3 times/); assert.match(text, /pizza 2 times/);
  assert.ok(h.indexOf('N_ggrows') > h.indexOf('N_list'), 'the card follows the number rows');
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
  let n = 0; const t = boot({ usage: () => (++n === 2 ? { data: null, error: { message: 'Failed to fetch' } } : { data: USAGE(), error: null }) }); await t.ready();
  assert.match(t.html(), /Devices/); await t.click('refresh'); // the first answer was good (seen), the second drops
  assert.match(t.html(), /The guest guide figures could not be loaded/); assert.match(t.html(), /data-n="retry" data-v="kpis"/);
  await t.click('retry', 'kpis'); assert.equal(usageCalls(t).length, 3); assert.match(t.html(), /Devices/); assert.ok(!/could not be loaded/.test(t.html()));
});
test('s136 r2 usage error card: before usage has answered OK once in this page session, a failure draws nothing (no card, no heading, no Try again)', async () => {
  const t = boot({ usage: () => ({ data: null, error: { message: 'Failed to fetch' } }) }); await t.ready();
  assert.equal(usageCalls(t).length, 1); assert.ok(!/Guest guide|could not be loaded|data-n="retry" data-v="kpis"/.test(t.html()), t.html().slice(0, 60)); assert.match(t.html(), /N_list/);
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
  for (const k of ['.N_gg ', '.N_ggrows', '.N_ggbar', '.N_gglist', '.N_h4']) assert.ok(CSS.includes(k), k);
  assert.equal((CSS.match(/\{/g) || []).length, (CSS.match(/\}/g) || []).length);
  const at = CSS.indexOf('.N_gg {'); assert.ok(at >= 0, 'the guide section marker is in the stylesheet');
  assert.doesNotMatch(CSS.slice(at), /#[0-9a-fA-F]{3,8}\b/, 'tokens only, no raw colours');
  assert.match(SRC, /canManage\(S\.role\)\) load\('gg', force\)/);
});

test('s136 r1 card layout: only rows, activity and funnel stay open; sections, taps and searches sit in ONE closed details with a 44 px summary', async () => {
  const t = boot({ usage: () => ({ data: USAGE(), error: null }) }); await t.ready();
  const h = t.html(), card = h.slice(h.indexOf('N_gg1')), d = card.match(/<details class="N_ggmore" data-n-fold="gg">(.*?)<\/details>/s);
  assert.ok(d, 'one details'); assert.equal((card.match(/<details/g) || []).length, 1); assert.ok(!/<details[^>]*open/.test(card), 'closed by default');
  assert.match(d[1], /<summary class="N_ggsum">More: guests, sections, taps, searches<\/summary>/);
  for (const w of ['Top sections', 'Top taps', 'Delivery searches with no result']) { assert.ok(d[1].includes(w), w + ' inside'); assert.ok(!card.replace(d[0], '').includes(w), w + ' not outside'); }
  for (const w of ['N_ggrows', 'N_ggspark', 'What guests do']) assert.ok(card.replace(d[0], '').includes(w), w + ' stays visible');
  assert.match(CSS, /\.N_ggsum \{[^}]*min-height: var\(--touch, 44px\)/);
  // height without a layout engine: the closed card at 360 px was measured at 413 px in the in-app browser (s136 r2); this pins the parts that make it up
  const closed = card.replace(d[0], '');
  assert.equal((closed.match(/<li>/g) || []).length, 5, '3 funnel steps + 2 plain rows'); assert.equal((closed.match(/N_row N_static N_kpi/g) || []).length, 2);
  assert.ok(!/N_ggtiles/.test(closed)); assert.match(CSS, /\.N_ggrows > \.N_row \{[^}]*padding: 5px 0/); assert.match(CSS, /\.N_gg \{ gap: 4px; \}/);
  const t2 = boot({ usage: () => ({ data: USAGE({ sections: [], top_taps: [], searches_without_result: [] }), error: null }) }); await t2.ready();
  assert.match(t2.html(), /<summary class="N_ggsum">More: guests/, 'guests may still load, so the fold stays');
});
test('s136 r1 card rows: labels never break inside a word (css), values wrap instead; the value is the short "views · time avg" form', () => {
  const row = CSS.match(/\.N_gglist > li \{[^}]*\}/)[0]; assert.match(row, /display: flex/); assert.match(row, /flex-wrap: wrap/);
  const lab = CSS.match(/^\.N_ggl \{[^}]*\}/m)[0]; assert.match(lab, /overflow-wrap: break-word/); assert.match(lab, /word-break: normal/); assert.doesNotMatch(lab, /anywhere|break-all/);
  assert.match(CSS, /\.N_gglist > li > \.N_ggv \{[^}]*flex: 0 1 auto/);
});
const widths = (html) => html.split('--w:').slice(1).map((x) => Number(x.split('%')[0]));
test('s136 r3 funnel bars: step 1 is 100%, a later step bigger than step 1 is capped at 100%, the last is its true share', async () => {
  const t = boot({ usage: () => ({ data: USAGE({ funnel: { verify_start: 4, verify_ok: 6, checklist_done: 2 } }), error: null }) }); await t.ready();
  assert.deepEqual(widths(t.html()), [100, 100, 50]);
});
test('s136 r3 sign-out: the shell reset clears the guide card memory (seen and absent) through N_Manage._resetGuideKnown, next to X_Inbox.reset', async () => {
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const fn = app.slice(app.indexOf('function H_resetModules()'), app.indexOf(String.fromCharCode(10), app.indexOf('function H_resetModules()')));
  const seen = []; const win = { X_Inbox: { reset() { seen.push('inbox'); } }, N_Manage: { _resetGuideKnown() { seen.push('guide'); } } };
  vm.runInNewContext(fn + '; H_resetModules();', { window: win }); assert.deepEqual(seen, ['inbox', 'guide']);
  // and the memory it clears is the real one: absent once, then a reset probes again (seen is cleared by the same call)
  const t = boot({ usage: null }); await t.ready(); assert.equal(usageCalls(t).length, 1);
  t.M.mount(t.el, { client: t.client, demo: false, role: 'owner', sub: 'kpis', navigate() {}, toast() {}, haptic() {} }); await tick(); assert.equal(usageCalls(t).length, 1, 'absent is remembered');
  win.N_Manage = t.M; vm.runInNewContext(fn + '; H_resetModules();', { window: win });
  t.M.mount(t.el, { client: t.client, demo: false, role: 'owner', sub: 'kpis', navigate() {}, toast() {}, haptic() {} }); await tick(); assert.equal(usageCalls(t).length, 2, 'after the shell reset the next visit probes again');
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

test('s136 r2 dense line: the axis is the 30 Manila dates ending at Manila today, not the server since (a UTC timestamptz); today is always the last point and the total is complete', async () => {
  const { M } = boot({ sub: 'today' }), G = M.lib.guestGuide, DAY = 86400000;
  // 2026-10-14 11:00 Manila (NOW = 03:00Z). since is the server's UTC timestamptz now - 30 days: its date is NOT the first Manila day of the window.
  const since = new Date(NOW - 30 * DAY).toISOString(); // 2026-09-14T03:00:00.000Z
  const byDay = [{ day: '2026-10-14', events: 7 }, { day: '2026-10-13', events: 2 }, { day: '2026-09-15', events: 3 }];
  const m = plain(G.model({ since, devices: 1, opens: 1, by_day: byDay }, 30));
  assert.equal(m.perDay.length, 30); assert.equal(m.perDay[29], 7, 'today is the last point'); assert.equal(m.perDay[28], 2); assert.equal(m.perDay[0], 3, '2026-09-15 is the first of 30 days ending 2026-10-14');
  assert.equal(m.perDay.reduce((a, v) => a + v, 0), 12, 'the total is complete: nothing dropped, nothing shifted');
  const old = plain(G.model({ since: '2026-09-15', devices: 1, opens: 1, by_day: byDay }, 30)); assert.deepEqual(old.perDay, m.perDay, 'same axis whatever since says');
  // 02:00 Manila on 2026-10-15 is 18:00Z on 2026-10-14: the UTC date is still the 14th, the Manila day is already the 15th
  const late = plain(G.model({ since, devices: 1, opens: 1, by_day: [{ day: '2026-10-15', events: 5 }, { day: '2026-10-14', events: 1 }] }, 30, '2026-10-15'));
  assert.equal(late.perDay[29], 5, 'at 02:00 Manila the new Manila day is the last point'); assert.equal(late.perDay[28], 1); assert.equal(late.perDay.reduce((a, v) => a + v, 0), 6);
  // the same through the real card at a frozen 02:00 Manila clock: the caption total counts today's rows
  const t = boot({ usage: () => ({ data: USAGE({ since: new Date(Date.parse('2026-10-14T18:00:00Z') - 30 * DAY).toISOString(), by_day: [{ day: '2026-10-15', devices: 1, events: 5 }, { day: '2026-10-14', devices: 1, events: 1 }] }), error: null }) });
  t.M._setClock(() => Date.parse('2026-10-14T18:00:00Z')); await t.click('refresh');
  assert.match(t.html().replace(/<[^>]+>/g, ' '), /Guide actions per day\. 6 in all\./);
});

test('s136 r2 since: a Manila date string and an old UTC timestamptz give the same axis (it is built from Manila today, since is never parsed for it)', () => {
  const { M } = boot({ sub: 'today' }), G = M.lib.guestGuide;
  const by = [{ day: '2026-10-14', events: 7 }, { day: '2026-09-15', events: 3 }];
  const a = plain(G.model({ since: '2026-09-15', devices: 1, opens: 1, by_day: by }, 30)), b = plain(G.model({ since: '2026-09-14T03:00:00+00:00', devices: 1, opens: 1, by_day: by }, 30)), c = plain(G.model({ devices: 1, opens: 1, by_day: by }, 30));
  assert.deepEqual(a.perDay, b.perDay); assert.deepEqual(a.perDay, c.perDay); assert.equal(a.perDay[0], 3); assert.equal(a.perDay[29], 7); assert.equal(a.since, '2026-09-15');
});

// ---- s136 lane B-guests: "Guests who used the guide" inside the More fold (staff_guide_guests_v1) ----
const guestCalls = (t) => t.calls.filter((c) => c[0] === 'staff_guide_guests_v1');
const GUEST = (i, o = {}) => Object.assign({ thread_id: 'th' + i, guest_label: 'Guest ' + i, checkin_date: '2026-10-' + String(10 + (i % 9)).padStart(2, '0'), checkout_date: '2026-10-' + String(12 + (i % 9)).padStart(2, '0'), first_seen: '2026-10-09T03:00:00Z', last_seen: '2026-10-13T03:00:00Z', opens: i, checklist_done: false, messaged: false }, o);
const GUESTS = (n, extra = {}) => Object.assign({ total: n, guests: Array.from({ length: n }, (_, i) => GUEST(i + 1)) }, extra);
const openFold = async (t, open = true) => { const d = { open, getAttribute: (k) => (k === 'data-n-fold' ? 'gg' : null) }; for (const f of t.el.l.toggle || []) f({ target: d }); await tick(); };
const gtext = (t) => t.html().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const okUsage = () => ({ data: USAGE(), error: null });

test('s136 guests fold: summary text, and the RPC is read lazily with exactly {p_days: 30}, only when the fold opens, cached after', async () => {
  const t = boot({ usage: okUsage, guests: () => ({ data: GUESTS(3), error: null }) }); await t.ready();
  assert.match(t.html(), /<summary class="N_ggsum">More: guests, sections, taps, searches<\/summary>/); assert.ok(!/More: sections, taps, searches/.test(t.html()));
  assert.equal(guestCalls(t).length, 0, 'a closed fold reads nothing');
  await openFold(t); assert.deepEqual(guestCalls(t).map((c) => c[1]), [{ p_days: 30 }]); assert.match(t.html(), /<details class="N_ggmore" data-n-fold="gg" open>/, 'a redraw keeps the fold open');
  await openFold(t, false); await openFold(t); assert.equal(guestCalls(t).length, 1, 'closing and opening again uses the cached answer');
  const t2 = boot({ sub: 'today', usage: okUsage, guests: () => ({ data: GUESTS(3), error: null }) }); await t2.ready(); assert.equal(guestCalls(t2).length, 0);
});
test('s136 guests rows: hand-computed lines, heading count, checklist and messaged marks, plain rows (no thread-open action exists on the card)', async () => {
  const g = { total: 3, guests: [GUEST(1, { guest_label: 'Honey R.', checkin_date: '2026-11-24', checkout_date: '2026-11-27', first_seen: '2026-11-23T03:00:00Z', opens: 14, checklist_done: true, messaged: true }),
    GUEST(2, { guest_label: 'Ken T.', checkin_date: '2026-10-30', checkout_date: '2026-11-02', first_seen: '2026-10-29T17:00:00Z', opens: 1 }), GUEST(3, { guest_label: null, checkin_date: null, checkout_date: null, first_seen: null, opens: 0 })] };
  const t = boot({ usage: okUsage, guests: () => ({ data: g, error: null }) }); await t.ready(); await openFold(t);
  const txt = gtext(t);
  assert.match(txt, /Guests who used the guide \(3\)/); assert.match(txt, /Honey R\. · 24–27 Nov First opened 23 Nov · 14 opens ✓ Checklist ✉ Messaged/);
  assert.match(txt, /Ken T\. · 30 Oct – 2 Nov First opened 30 Oct · 1 open(?! ✓| ✉)/, 'cross-month range; 17:00Z is already the next Manila day'); assert.match(txt, /Guest 0 opens/, 'no label: "Guest", no invented dates');
  const h = t.html(), block = h.slice(h.indexOf('class="N_ggguests"'), h.indexOf('Top sections')); assert.ok(!/ggg-all/.test(block), 'under ten: no Show all'); assert.equal((block.match(/class="N_row N_static"/g) || []).length, 3);
  assert.ok(h.indexOf('id="N_ggg"') < h.indexOf('Top sections'), 'guests come first in the fold'); assert.ok(!/<button|<a /.test(block), 'no row is a button or a link');
});
test('s136 guests cap: 14 guests show 10 and a "Show all (14)" row; tapping it shows all 14 and the row goes', async () => {
  const t = boot({ usage: okUsage, guests: () => ({ data: GUESTS(14), error: null }) }); await t.ready(); await openFold(t);
  const count = () => (t.html().match(/class="N_row N_static"><span class="N_rowmid"><span class="N_rowt">Guest \d+/g) || []).length;
  assert.equal(count(), 10); assert.match(gtext(t), /Guests who used the guide \(14\)/); assert.match(t.html(), /data-n="ggg-all"><span class="N_rowmid"><span class="N_rowt">Show all \(14\)<\/span>/);
  await t.click('ggg-all'); assert.equal(count(), 14); assert.ok(!/ggg-all/.test(t.html())); assert.match(t.html(), /<details class="N_ggmore" data-n-fold="gg" open>/);
  const t10 = boot({ usage: okUsage, guests: () => ({ data: GUESTS(10), error: null }) }); await t10.ready(); await openFold(t10); assert.ok(!/ggg-all/.test(t10.html()), 'exactly ten: no Show all');
  const tN = boot({ usage: okUsage, guests: () => ({ data: GUESTS(10, { total: 1234 }), error: null }) }); await tN.ready(); await openFold(tN); assert.match(tN.html(), /Show all \(1,234\)/, 'N is the server total, not the length');
});
test('s136 guests empty: no rows and single_property say the same plain line; zero in the heading', async () => {
  for (const [name, data] of [['empty', { total: 0, guests: [] }], ['single', { total: 3, guests: [GUEST(1)], single_property: true }]]) {
    const t = boot({ usage: okUsage, guests: () => ({ data, error: null }) }); await t.ready(); await openFold(t);
    assert.match(gtext(t), /Guests who used the guide \(0\) No guest has signed in to the guide in the last 30 days\./, name); assert.ok(!/N_ggguests/.test(t.html()), name);
  }
});
test('s136 guests error path: a dropped connection shows one line and Try again, which reads once more; a missing function or refused account draws no guests block and is not asked again', async () => {
  let n = 0; const t = boot({ usage: okUsage, guests: () => (++n === 1 ? { data: null, error: { message: 'Failed to fetch' } } : { data: GUESTS(2), error: null }) }); await t.ready(); await openFold(t);
  assert.match(t.html(), /The guest list could not be loaded/); assert.match(t.html(), /data-n="ggg-retry"/); assert.match(gtext(t), /Top sections/, 'the rest of the fold still draws');
  await t.click('ggg-retry'); assert.equal(guestCalls(t).length, 2); assert.match(gtext(t), /Guests who used the guide \(2\)/); assert.ok(!/could not be loaded/.test(t.html()));
  for (const [name, guests] of [['missing', null], ['refused', () => ({ data: null, error: { code: '42501', message: 'not authorised' } })]]) {
    const u = boot({ usage: okUsage, guests }); await u.ready(); await openFold(u);
    assert.ok(!/Guests who used the guide|N_ggguests/.test(u.html()), name); assert.match(gtext(u), /Top sections/, name); await openFold(u, false); await openFold(u); assert.equal(guestCalls(u).length, 1, name + ': one read');
  }
  const only = boot({ usage: () => ({ data: USAGE({ sections: [], top_taps: [], searches_without_result: [] }), error: null }), guests: null }); await only.ready(); await openFold(only); assert.ok(!/N_ggmore/.test(only.html()), 'nothing left to fold once guests are known missing');
});
test('s136 guests escaping: HTML in guest_label is escaped, never markup', async () => {
  const t = boot({ usage: okUsage, guests: () => ({ data: { total: 1, guests: [GUEST(1, { guest_label: EVIL + '"x', thread_id: EVIL })] }, error: null }) }); await t.ready(); await openFold(t);
  assert.ok(!t.html().includes('<img'), 'no raw tag'); assert.ok(t.html().includes('&lt;img src=x onerror=alert(1)&gt;'), 'shown as text'); assert.ok(!t.html().includes(EVIL), 'thread_id is never drawn');
});
test('s136 guests reset: _resetGuideKnown clears the absent memory and drops the cached guests (another person signs in)', async () => {
  const t = boot({ usage: okUsage, guests: null }); await t.ready(); await openFold(t); assert.equal(guestCalls(t).length, 1);
  t.M.mount(t.el, { client: t.client, demo: false, role: 'owner', sub: 'kpis', navigate() {}, toast() {}, haptic() {} }); await tick(); await openFold(t); assert.equal(guestCalls(t).length, 1, 'absent is remembered for the session');
  t.M._resetGuideKnown(); t.M.mount(t.el, { client: t.client, demo: false, role: 'owner', sub: 'kpis', navigate() {}, toast() {}, haptic() {} }); await tick(); await openFold(t); assert.equal(guestCalls(t).length, 2, 'after the reset the next open probes again');
  const u = boot({ usage: okUsage, guests: () => ({ data: GUESTS(2), error: null }) }); await u.ready(); await openFold(u); assert.match(gtext(u), /Guests who used the guide \(2\)/);
  u.M._resetGuideKnown(); await openFold(u, false); await openFold(u); assert.equal(guestCalls(u).length, 2, 'the cached list was dropped, so opening reads again');
});
test('s136 guests css: the mockup rules ship and braces balance', () => {
  for (const k of ['.N_ggguests { display: grid; }', '.N_ggmeta { display: flex; flex-wrap: wrap; gap: 0 10px; }', '.N_ggguests > .N_row.N_static { padding-top: 8px; padding-bottom: 8px; min-height: 0; }']) assert.ok(CSS.includes(k), k);
  assert.equal((CSS.match(/\{/g) || []).length, (CSS.match(/\}/g) || []).length);
});
