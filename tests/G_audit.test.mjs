// Final-audit fix round (prefix G_). Red-first for the sheet header, the mouse, large text, the service worker; the rest are guards for the smaller fixes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CS, read, boot, HOMEWITH, baseHandlers, stayRow, TODAY } from './_a_harness.mjs';

const css = read('styles.css'), HERE = path.dirname(fileURLToPath(import.meta.url));
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const T = (o) => Object.assign({ source: 'follow_up_tasks', id: 'a', kind: 'reminder', title: 'Water the plants', priority: 'normal', status: 'open', due_at: '2026-10-12T09:00:00Z', mine: true, blocks_arrival: false, detail: null, assignee_label: null, created_at: '2026-10-01T00:00:00Z' }, o);
const tasksOf = (list, manager) => () => ({ error: null, data: { ok: true, manager: !!manager, today: TODAY, tasks: list } });
const surf = (x) => Object.assign({ style: {}, offsetWidth: 360, offsetHeight: 400, scrollTop: 0, isConnected: true, parentNode: { classList: { add() {}, remove() {}, contains: () => false }, style: {} }, classList: { add() {}, remove() {}, contains: () => false }, getAttribute: () => null, setAttribute() {}, querySelector: () => null, contains(t) { return t === this; }, setPointerCapture() {} }, x || {});
const drive = (app, el, pts, pick, extra) => { const fire = (t, ev) => (app.listeners[t] || []).forEach((f) => f(ev)); const target = { closest: (s) => pick(s, el) };
  pts.forEach((p, i) => { const ev = Object.assign({ clientX: p[1], clientY: p[2], pointerId: 1, timeStamp: p[0], button: 0 }, extra || {}); if (i === 0) fire('pointerdown', Object.assign(ev, { target })); else fire(i === pts.length - 1 ? 'pointerup' : 'pointermove', ev); }); };

// ------------------------------------------------------------------------------------------------ 2: the header is a real row
test('G_ sheet header: a real sticky row (title left, Close right, its own height, opaque), the content starts below it; "Try again" is in the body, never under Close', async () => {
  const b = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = /\.F_sheethead \{([^}]*)\}/.exec(b)[1]; assert.match(rule, /position: sticky/); assert.match(rule, /background: var\(--v5-surf\)/); assert.match(rule, /display: flex/); assert.doesNotMatch(rule, /height: 0/, 'it takes room: no zero-height overlay');
  const offline = await boot({ role: 'cleaner', hash: '#home', handlers: baseHandlers('cleaner', { staff_home_v1: () => ({ error: { message: 'TypeError: Failed to fetch' }, data: null }) }) });
  await offline.click({ 'data-act': 'attn-open' });
  const html = offline.els['cs-body'].innerHTML, end = html.indexOf('</div>', html.indexOf('F_close')), head = html.slice(0, end + 6), body = html.slice(end + 6);
  assert.match(head, /^<div class="F_sheethead"><h2 class="ttl" id="cs-h"[^>]*>To look at<\/h2><button class="btn btn-secondary btn-sm F_close"/); assert.doesNotMatch(head, /Try again/);
  assert.match(body, /data-act="refresh">Try again<\/button>/, 'Try again is in the body, below the header row');
  const stale = await boot({ role: 'admin', hash: '#home', handlers: baseHandlers('admin', { staff_home_v1: () => HOMEWITH([]), tasks_list_v1: tasksOf([], true), notices_v1: () => ({ error: { code: '500', message: 'x' }, data: null }) }) });
  await stale.click({ 'data-act': 'attn-open' }); const sh = stale.els['cs-body'].innerHTML; assert.ok(sh.indexOf('Close</button></div>') < sh.indexOf('Try again'));
  assert.equal((sh.match(/<h2 class="ttl"/g) || []).length, 1, 'the title moved into the header, it is not drawn twice');
});

// ------------------------------------------------------------------------------------------------ 4: the mouse
test('G_ a mouse drag is never a swipe (it is selecting text); touch and pen still are', async () => {
  const app = await boot({ role: 'admin', hash: '#tasks', handlers: baseHandlers('admin', { tasks_list_v1: tasksOf([T({})], true), task_set_done_v1: () => ({ error: null, data: { ok: true } }) }) });
  const row = () => surf({ getAttribute: (k) => ({ 'data-task': 'follow_up_tasks:a', 'data-E-swipe': 'task-done', 'data-E-w': '96' })[k] ?? null });
  const pick = (s, el) => (s === '.taskrow[data-E-swipe]' ? el : null), pts = [[0, 330, 200], [30, 300, 201], [60, 200, 201], [90, 150, 201], [120, 150, 201]];
  drive(app, row(), pts, pick, { pointerType: 'mouse' }); await app.flush(); assert.equal(app.calls.filter((c) => c[0] === 'task_set_done_v1').length, 0, 'a fast mouse drag across a task title marks nothing done');
  drive(app, row(), pts, pick, { pointerType: 'touch' }); await app.flush(); assert.equal(app.calls.filter((c) => c[0] === 'task_set_done_v1').length, 1, 'a finger does');
  const pen = await boot({ role: 'admin', hash: '#tasks', handlers: baseHandlers('admin', { tasks_list_v1: tasksOf([T({})], true), task_set_done_v1: () => ({ error: null, data: { ok: true } }) }) });
  drive(pen, row(), pts, pick, { pointerType: 'pen' }); await pen.flush(); assert.equal(pen.calls.filter((c) => c[0] === 'task_set_done_v1').length, 1, 'a pen does');
  const cal = await boot({ role: 'admin', hash: '#calendar', handlers: baseHandlers('admin', { staff_home_v1: () => HOMEWITH([stayRow('Ana', '2026-10-14', '2026-10-17')]) }) });
  drive(cal, surf(), [[0, 300, 300], [100, 250, 302], [200, 100, 302], [260, 100, 302]], (s, el) => (s === '.E_tabbody' ? el : null), { pointerType: 'mouse' }); assert.equal(cal.location.hash, '#calendar', 'nor does a mouse swipe the calendar views');
});
test('G_ a gesture dropped by a new touch hands its row back (cancel is called)', () => {
  const root = { l: {}, addEventListener(t, f) { (this.l[t] ||= []).push(f); }, fire(t, e) { (this.l[t] || []).forEach((f) => f(e)); } }, log = [], el = surf();
  CS.E_drag(root, { sel: 'S', axis: 'x', vw: () => 360, move: () => log.push('move'), cancel: () => log.push('cancel') });
  const t = { closest: () => el }; root.fire('pointerdown', { target: t, clientX: 100, clientY: 10, pointerId: 1, timeStamp: 0, button: 0 }); root.fire('pointermove', { clientX: 150, clientY: 10, pointerId: 1, timeStamp: 10 });
  root.fire('pointerdown', { target: t, clientX: 100, clientY: 10, pointerId: 2, isPrimary: true, timeStamp: 100, button: 0 }); assert.deepEqual(log, ['move', 'cancel']);
});

// ------------------------------------------------------------------------------------------------ 5: large text
test('G_ large text: nothing is wider than its box (pills wrap, long values break, the hours strip scrolls inside itself, inputs and sub-tabs shrink or scroll in their own box)', () => {
  const b = strip(css), has = (re, msg) => assert.match(b, re, msg);
  has(/\.pill \{ max-width: 100%; min-width: 0; white-space: normal;/, 'a pill wraps instead of widening the page'); has(/\.ctval, \.ctrow \{ min-width: 0; overflow-wrap: anywhere; \}/, 'an e-mail breaks');
  has(/\.A_hours \{ overflow-x: auto; grid-auto-columns: minmax\(2\.75rem, 1fr\); \}/, 'the strip scrolls in its own box'); has(/\.input input \{ width: 100%; min-width: 0; \}/, 'rate inputs shrink'); has(/\.field, \.input, \.input input, \.sel, \.stack > \*, \.card, \.A_card, \.mid \{ min-width: 0; \}/);
  has(/\.A_tabs \{ overflow-x: auto; grid-template-columns: repeat\(2, minmax\(max-content, 1fr\)\);/, 'sub-tabs scroll inside their bar'); has(/\.A_herobar \.brand \{ font-size: var\(--v5-t-wordmark\); \}/); has(/\.A_chipglass, \.E_pill \{ font-size: var\(--v5-t-pill\); \}/);
  const tk = read('tokens.css'); assert.match(tk, /--v5-t-pill: clamp\(13px, 0\.8125rem, 15px\);/); assert.match(tk, /--v5-t-wordmark: clamp\(18px, 1\.375rem, 24px\);/);
});

// ------------------------------------------------------------------------------------------------ 3 and 6: the pay pages and the grid
test('G_ the pay pages keep clear of the rail (landscape phones too); the two-column grid starts at 42 rem; Turnover is not stretched; the hero is a third of the height at most; no lone card', () => {
  const b = strip(css), railQ = '@media (min-width: 52.5rem), (min-width: 37.5rem) and (max-height: 30rem) {', i = b.indexOf(railQ); assert.ok(i >= 0);
  const rail = b.slice(i, b.indexOf('\n}\n', i)); assert.match(rail, /body > \.shell:not\(#app\) \{ max-width: min\(40rem, calc\(100% - 2 \* var\(--v5-nav-w\)\)\); \}/, 'pay shell offset in the rail query, not only at 840');
  assert.match(b, /@media \(min-width: 42rem\) \{\s*\.A_body \{ grid-template-columns: repeat\(2/); assert.doesNotMatch(b.slice(b.indexOf('@media (min-width: 37.5rem) {'), b.indexOf('@media (min-width: 42rem)')), /\.A_body \{ grid-template-columns/);
  assert.match(b, /\[aria-label="Turnover today"\] \{ align-self: start; \}/); assert.match(b, /\.A_hero \{ aspect-ratio: 16 \/ 7; max-height: max\(15\.75rem, 34vh\); \}/);
  assert.match(b, /\[aria-label="Today in the house"\] \{ grid-template-columns: minmax\(0, 1fr\) auto;/, 'Today is two columns on a wide screen'); assert.match(b, /#v-more \.stack > \.F_group:last-child:nth-child\(even\) \{ grid-column: 1 \/ -1; \}/);
  assert.match(b, /\.scrim\[data-F-kind="day"\], \.scrim\[data-F-kind="attn"\] \{ left: var\(--v5-nav-w\); \}/, 'the side sheet scrim leaves the rail alone');
});

// ------------------------------------------------------------------------------------------------ 7 and 8: modal focus and typed text
test('G_ a sheet makes the app inert while open and gives focus back; Escape and the scrim keep what was typed; Close asks once', async () => {
  const attrs = {}, appEl = { setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: (k) => { delete attrs[k]; }, getAttribute: (k) => (k in attrs ? attrs[k] : null), classList: { toggle() {}, add() {}, remove() {}, contains: () => false }, innerHTML: '', style: {}, hidden: false, focus() {}, querySelector: () => null, querySelectorAll: () => [] };
  const app = await boot({ role: 'admin', hash: '#tasks', els: { app: appEl }, handlers: baseHandlers('admin', { tasks_list_v1: tasksOf([T({})], true) }) });
  await app.click({ 'data-act': 'task-add-open' }); assert.equal(attrs.inert, '', 'the app behind the dialog cannot be tabbed to'); assert.match(read('app.js'), /appEl\.setAttribute\('inert', ''\)/);
  const esc = () => (app.listeners.keydown || []).forEach((f) => f({ key: 'Escape', target: { closest: () => null } })), shut = () => app.els['cal-sheet'].getAttribute('aria-hidden') === 'true';
  app.input('t-title', 'Buy bulbs'); esc(); assert.ok(!shut(), 'Escape keeps the typing'); assert.match(app.els['cs-body'].innerHTML, /Close with the Close button to discard what you typed\./); assert.equal(attrs.inert, '');
  await app.click({ 'data-act': 'task-add-cancel', 'data-F-close': '1' }); assert.ok(!shut(), 'Close on typed text asks first'); assert.match(app.els['cs-body'].innerHTML, /Discard what you typed\?[^]*id="F_keep" data-act="discard-keep">Keep editing[^]*data-act="task-add-cancel">Discard/);
  await app.click({ 'data-act': 'discard-keep' }); assert.ok(!shut()); assert.doesNotMatch(app.els['cs-body'].innerHTML, /Discard what you typed\?/);
  await app.click({ 'data-act': 'task-add-cancel', 'data-F-close': '1' }); await app.click({ 'data-act': 'task-add-cancel' }); assert.ok(shut(), 'Discard closes it'); assert.equal(attrs.inert, undefined, 'and the app is live again');
  await app.click({ 'data-act': 'task-add-open' }); esc(); assert.ok(shut(), 'with nothing typed Escape closes');
  // the day note, the notice form and the pay-rate confirm are protected the same way
  const day = await boot({ role: 'admin', hash: '#calendar', handlers: baseHandlers('admin', { staff_home_v1: () => HOMEWITH([stayRow('Ana', '2026-10-14', '2026-10-17')]) }) });
  await day.click({ 'data-day': '2026-10-16' }); await day.click({ 'data-act': 'dayform-open' }); day.input('df-label', 'Plumber'); (day.listeners.keydown || []).forEach((f) => f({ key: 'Escape', target: { closest: () => null } })); assert.equal(day.els['cal-sheet'].getAttribute('aria-hidden'), 'false');
  const nadd = await boot({ role: 'admin', hash: '#calendar', handlers: baseHandlers('admin') }); await nadd.click({ 'data-act': 'notice-add-open', 'data-date': TODAY }); nadd.input('n-title', 'Pipe'); (nadd.listeners.keydown || []).forEach((f) => f({ key: 'Escape', target: { closest: () => null } })); assert.equal(nadd.els['cal-sheet'].getAttribute('aria-hidden'), 'false');
  assert.match(read('app.js'), /sc\.addEventListener\('click', E_tryClose\)/, 'the scrim goes through the same check');
});

// ------------------------------------------------------------------------------------------------ 9: the service worker
function loadSw(src) { const h = {}, shown = []; const sandbox = { self: { addEventListener: (t, f) => { h[t] = f; }, location: new URL('https://x.github.io/Cascade-Staff/sw.js'), registration: { showNotification: (t, o) => { shown.push([t, o]); return Promise.resolve(); } }, clients: {} }, module: { exports: {} }, URL, Request: class { constructor(u, i) { this.url = u; this.cache = i && i.cache; } }, setTimeout, caches: {}, fetch() {}, importScripts: src.importScripts }; vm.runInNewContext(src.code, sandbox); return { h, shown, sandbox }; }
test('G_ sw: a missing push file cannot stop the worker installing; the install precache asks the server (cache: reload)', async () => {
  const code = fs.readFileSync(path.join(HERE, '..', 'sw.js'), 'utf8'), added = [];
  const w = loadSw({ code, importScripts() { throw new Error('404 pay/C_push-sw.js'); } }); assert.ok(w.h.install && w.h.fetch, 'the worker still registered its handlers');
  const cache = { add: (r) => { added.push(r); return Promise.resolve(); } }; w.sandbox.caches = { open: () => Promise.resolve(cache) }; w.sandbox.self.skipWaiting = () => Promise.resolve();
  let waited; w.h.install({ waitUntil: (p) => { waited = p; } }); await waited; assert.ok(added.length > 20); for (const r of added) assert.equal(r.cache, 'reload', String(r.url));
});
test('G_ push: the title goes through the amount filter like the body; PHP 1,235, ₱1,235, P500, 500 pesos and 4+ digit runs are all replaced', () => {
  const code = fs.readFileSync(path.join(HERE, '..', 'pay', 'C_push-sw.js'), 'utf8'), h = {}, shown = [];
  vm.runInNewContext(code, { self: { addEventListener: (t, f) => { h[t] = f; }, registration: { showNotification: (t, o) => { shown.push([t, o.body]); return Promise.resolve(); } } } });
  const push = (title, body) => h.push({ data: { json: () => ({ title, body }) }, waitUntil() {} });
  for (const bad of ['You were paid PHP 1,235', 'Sent ₱1,235 today', 'Paid P500', 'Paid P 500', 'We sent 500 pesos', '500 php', 'ref 123456', 'Php 40', '1.5 pesos']) { shown.length = 0; push(bad, bad); assert.deepEqual(shown[0], ['Cascade Staff', 'Open Cascade Staff for the details.'], bad); }
  for (const ok of ['Your payment has been sent', 'Hi Honey, your pay for Oct 10 to Oct 12 is on its way to your MariBank account. Open Cascade Staff for the details.', 'Pending: 3 items']) { shown.length = 0; push(ok, ok); assert.equal(shown[0][0], ok.slice(0, 80)); assert.equal(shown[0][1], ok.slice(0, 240)); }
  shown.length = 0; push('', 'Hello'); assert.equal(shown[0][0], 'Cascade Staff', 'an empty title still falls back');
});

// ------------------------------------------------------------------------------------------------ 10: smaller fixes
test('G_ errors say what happened: a 5xx or a server statement timeout is "Could not update", a fetch failure or abort is "No connection"; a partial result keeps its count and says some items could not be loaded', async () => {
  const pill = (app) => (/class="E_lbl">([^<]*)</.exec(app.els['v-home'].innerHTML) || [])[1];
  for (const [message, want, banner] of [['canceling statement due to statement timeout', 'Could not update', /Could not update\./], ['Failed to fetch', 'No connection', /needs a connection/], ['The user aborted a request', 'No connection', /needs a connection/], ['fetch timeout', 'No connection', /needs a connection/]]) {
    const app = await boot({ role: 'cleaner', hash: '#home', handlers: baseHandlers('cleaner', { staff_home_v1: () => ({ error: { code: '57014', message }, data: null }) }) }); assert.equal(pill(app), want, message); assert.match(app.els['v-home'].innerHTML, banner, message + ': the banner agrees with the pill');
  }
  const t = await boot({ role: 'cleaner', hash: '#tasks', handlers: baseHandlers('cleaner', { tasks_list_v1: () => ({ error: { code: '500', message: 'boom' }, data: null }) }) }); assert.match(t.els['v-tasks'].innerHTML, /Could not update\./); assert.doesNotMatch(t.els['v-tasks'].innerHTML, /needs a connection/);
  const a = CS.E_attention({ role: 'admin', today: TODAY, ready: { payload: true, tasks: true, bookings: true, notices: true }, failed: { notices: true }, tasks: [T({ blocks_arrival: true })] });
  assert.equal(a.phase, 'items'); assert.equal(a.pill.text, '1 task · 1 blocks arrival'); assert.equal(a.partial, true);
  const app = await boot({ role: 'admin', hash: '#home', handlers: baseHandlers('admin', { staff_home_v1: () => HOMEWITH([]), tasks_list_v1: tasksOf([T({ blocks_arrival: true })], true), notices_v1: () => ({ error: { code: '500', message: 'x' }, data: null }) }) });
  await app.click({ 'data-act': 'attn-open' }); assert.match(app.els['cs-body'].innerHTML, /Some items could not be loaded<\/span><button class="btn btn-ghost btn-sm" type="button" data-act="refresh">Try again/);
});
test('G_ the day row in the pill opens the day sheet after the calendar has settled, so a Home redraw cannot close it; inline sizes are tokens; the README names the current cache', async () => {
  const app = await boot({ role: 'admin', hash: '#home', handlers: baseHandlers('admin', { staff_home_v1: () => HOMEWITH([stayRow('Ana', '2026-10-20', '2026-10-24'), stayRow('Ben', '2026-10-22', '2026-10-25')]), tasks_list_v1: tasksOf([], true) }) });
  await app.click({ 'data-act': 'attn-open' }); await app.click({ 'data-act': 'notice-cal', 'data-date': '2026-10-22' });
  assert.equal(app.els['cal-sheet'].getAttribute('aria-hidden'), 'true', 'nothing is open on Home while the calendar loads'); await app.click({ 'data-act': 'refresh' });
  for (const f of app.winListeners.hashchange || []) f(); await app.flush(); assert.equal(app.els['cal-sheet'].getAttribute('aria-hidden'), 'false'); assert.match(app.els['cs-body'].innerHTML, /Thursday 22 October|22 October/);
  assert.doesNotMatch(read('app.js'), /font-size:\s*1[0-9]px/); assert.doesNotMatch(read('install/index.html'), /font-size:\s*16px/); assert.match(read('install/index.html'), /\.inst \.big \{ height: 64px; font-size: 1rem; \}/);
  const sw = read('sw.js'), name = /CACHE_NAME = '(cs-shell-v\d+)'/.exec(sw)[1]; assert.ok(read('README.md').includes('`' + name + '`'), 'README names ' + name); assert.doesNotMatch(read('README.md'), /cs-shell-v11/);
});
