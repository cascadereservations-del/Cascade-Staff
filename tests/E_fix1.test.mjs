// Lane E, fix round 1 (review of 5192ca2..990abf1: PASS_WITH_FIXES). One red-first test for each of F1 to F11, plus the first-paint dashboard link. Frozen clocks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CS, read, boot, HOMEWITH, NOTICES_RAW, baseHandlers, stayRow, TODAY } from './_a_harness.mjs';

const css = read('styles.css');
const T = (o) => Object.assign({ source: 'follow_up_tasks', id: 'a', kind: 'reminder', title: 'Water the plants', priority: 'normal', status: 'open', due_at: '2026-10-12T09:00:00Z', mine: true, blocks_arrival: false, detail: null, assignee_label: null, created_at: '2026-10-01T00:00:00Z' }, o);
const tasksOf = (list, manager) => () => ({ error: null, data: { ok: true, manager: !!manager, today: TODAY, tasks: list } });
const home = (extra) => () => HOMEWITH([], extra);
const pillText = (app) => (/class="E_lbl">([^<]*)</.exec(app.els['v-home'].innerHTML) || [])[1];
const FOLD = { schema: 1, surfaces: { admin: { files: 84 }, checklist: { files: 8 }, manual: { files: 16 }, guide: { files: 48, adminGuide: true } } };
const drive = (app, surface, pts, pick) => { const fire = (t, ev) => (app.listeners[t] || []).forEach((f) => f(ev)); const target = { closest: (s) => pick(s, surface) };
  pts.forEach((p, i) => { const ev = { clientX: p[1], clientY: p[2], pointerId: p[3] || 1, timeStamp: p[0], button: 0 }; if (i === 0) fire('pointerdown', Object.assign(ev, { target })); else fire(i === pts.length - 1 ? 'pointerup' : 'pointermove', ev); }); };
const surf = (x) => Object.assign({ style: {}, offsetWidth: 360, offsetHeight: 400, scrollTop: 0, isConnected: true, parentNode: { classList: { add() {}, remove() {}, contains: () => false }, style: {} }, classList: { add() {}, remove() {}, contains: () => false }, getAttribute: () => null, setAttribute() {}, querySelector: () => null, contains(t) { return t === this; }, setPointerCapture() {} }, x || {});

// ------------------------------------------------------------------------------------------------ F1
test('E_fix F1: a fast flick commits only past a 48 px floor and only the way the finger went (task row, calendar views, sheet)', () => {
  assert.equal(CS.E_taskCommit(-13, 360, -0.5), false, 'a 13 px sideways flick while starting a scroll'); assert.equal(CS.E_taskCommit(30, 360, -0.6), false, 'dragged right, flicked back'); assert.equal(CS.E_taskCommit(-48, 360, -0.5), true); assert.equal(CS.E_taskCommit(-60, 360, 0.5), false, 'a velocity the other way');
  assert.equal(CS.E_tabCommit(-13, 360, -0.5), false); assert.equal(CS.E_tabCommit(30, 360, -0.6), false, 'dragged right, flicked left'); assert.equal(CS.E_tabCommit(-30, 360, 0.9), false); assert.equal(CS.E_tabCommit(48, 360, 0.4), true); assert.equal(CS.E_tabCommit(-48, 360, -0.4), true); assert.equal(CS.E_tabCommit(-90, 360, 0), true, 'the distance rule is unchanged');
  assert.equal(CS.E_sheetCommit(-10, 0.6), false, 'dragged up'); assert.equal(CS.E_sheetCommit(13, 0.9), false); assert.equal(CS.E_sheetCommit(30, -0.9), false); assert.equal(CS.E_sheetCommit(48, 0.5), true); assert.equal(CS.E_sheetCommit(96, 0), true, 'the distance rule is unchanged');
});
test('E_fix F1: in the app a 13 px flick on a task row does nothing, and a 60 px flick still marks it done', async () => {
  const app = await boot({ role: 'admin', hash: '#tasks', handlers: baseHandlers('admin', { tasks_list_v1: tasksOf([T({})], true), task_set_done_v1: () => ({ error: null, data: { ok: true } }) }) });
  const row = () => surf({ getAttribute: (k) => ({ 'data-task': 'follow_up_tasks:a', 'data-E-swipe': 'task-done', 'data-E-w': '96' })[k] ?? null });
  drive(app, row(), [[0, 330, 200], [4, 322, 200], [8, 317, 200], [12, 317, 200]], (s, el) => (s === '.taskrow[data-E-swipe]' ? el : null)); await app.flush();
  assert.equal(app.calls.filter((c) => c[0] === 'task_set_done_v1').length, 0, 'a 13 px flick is not a swipe');
  drive(app, row(), [[100, 330, 200], [130, 310, 200], [160, 270, 200], [170, 270, 200]], (s, el) => (s === '.taskrow[data-E-swipe]' ? el : null)); await app.flush();
  assert.equal(app.calls.filter((c) => c[0] === 'task_set_done_v1').length, 1);
});

// ------------------------------------------------------------------------------------------------ F2 and F10
test('E_fix F2: the pill never says "All clear" when a source its role depends on failed; a missing feature is not a failure', async () => {
  const bad = { error: { code: '500', message: 'boom' }, data: null }, gone = { error: { code: 'PGRST202', message: 'Could not find the function' }, data: null };
  const cleaner = await boot({ role: 'cleaner', hash: '#home', handlers: baseHandlers('cleaner', { staff_home_v1: home(), tasks_list_v1: () => bad }) });
  assert.equal(pillText(cleaner), 'Could not update', 'tasks failed on first load');
  const admin = await boot({ role: 'admin', hash: '#home', handlers: baseHandlers('admin', { staff_home_v1: home(), tasks_list_v1: tasksOf([], true), notices_v1: () => bad }) });
  assert.equal(pillText(admin), 'Could not update', 'notices failed');
  const bk = await boot({ role: 'owner', hash: '#home', handlers: baseHandlers('owner', { staff_home_v1: home(), tasks_list_v1: tasksOf([], true), staff_inquiry_payments_v1: () => bad }) });
  assert.equal(pillText(bk), 'Could not update', 'bookings failed');
  const ok = await boot({ role: 'admin', hash: '#home', handlers: baseHandlers('admin', { staff_home_v1: home(), tasks_list_v1: tasksOf([], true), notices_v1: () => gone, staff_inquiry_payments_v1: () => gone }) });
  assert.equal(pillText(ok), 'All clear', 'RPCs that are not there yet are not failures');
  const denied = await boot({ role: 'cleaner', hash: '#home', handlers: baseHandlers('cleaner', { staff_home_v1: home(), tasks_list_v1: () => ({ error: null, data: { ok: false } }) }) });
  assert.equal(pillText(denied), 'All clear', 'tasks are not available for this account: nothing to say');
  await admin.click({ 'data-act': 'attn-open' }); assert.match(admin.els['cs-body'].innerHTML, /Could not update/); assert.match(admin.els['cs-body'].innerHTML, /data-act="refresh">Try again/);
  const aria = /aria-label="([^"]*)"/.exec(/<button class="A_chipglass E_pill"[^>]*>/.exec(admin.els['v-home'].innerHTML)[0])[1]; assert.equal(aria, 'Could not update. Showing the last update from 12:30. Opens the list');
});
test('E_fix F2: a task due today is counted ("Due today", after Overdue), so the pill and the Tasks badge agree; All clear never shows beside a non-zero badge', async () => {
  const a = CS.E_attention({ role: 'cleaner', today: TODAY, ready: { payload: true, tasks: true }, tasks: [T({ id: 'o', due_at: '2026-10-10T09:00:00Z' }), T({ id: 't', due_at: '2026-10-15T09:00:00Z' }), T({ id: 'l', due_at: '2026-10-20T09:00:00Z' })] });
  assert.deepEqual(a.sections.map((s) => s.key), ['overdue', 'due']); assert.equal(a.n, 2); assert.equal(a.sections[1].label, 'Due today'); assert.match(a.sections[1].rows[0].sub, /^Due today/);
  const b = CS.E_attention({ role: 'cleaner', today: TODAY, ready: { payload: true, tasks: true }, tasks: [T({ due_at: '2026-10-15T09:00:00Z' })] });
  assert.deepEqual([b.n, b.tone, b.top, b.pill.text, b.pill.dot], [1, 'warn', '1 due today', '1 · Due today', 'warn']);
  for (const role of ['cleaner', 'admin']) {
    const app = await boot({ role, hash: '#home', handlers: baseHandlers(role, { staff_home_v1: home(), tasks_list_v1: tasksOf([T({ due_at: '2026-10-15T09:00:00Z' })], role === 'admin') }) });
    assert.match(app.els.tabbar.innerHTML, /aria-label="1 due"/); assert.notEqual(pillText(app), 'All clear', role); assert.equal(pillText(app), '1 · Due today', role);
  }
  // the counted groups are exactly what the tabs count: for any mix, a badge above zero means the pill is not All clear
  for (const tasks of [[], [T({ due_at: '2026-10-15T09:00:00Z' })], [T({ due_at: '2026-10-01T09:00:00Z' })], [T({ blocks_arrival: true, due_at: null })]]) {
    const badge = CS.taskDueCount(tasks, TODAY), p = CS.E_attention({ role: 'cleaner', today: TODAY, ready: { payload: true, tasks: true }, tasks }).pill.text;
    if (badge > 0) assert.notEqual(p, 'All clear');
  }
});
test('E_fix F10: "No connection" only for a network failure; a 5xx, an expired session or the blocked payload say "Could not update"', async () => {
  const kinds = [['TypeError: Failed to fetch', 'No connection'], ['Network request failed', 'No connection'], ['internal error', 'Could not update'], ['JWT expired', 'Could not update']];
  for (const [message, want] of kinds) { const app = await boot({ role: 'cleaner', hash: '#home', handlers: baseHandlers('cleaner', { staff_home_v1: () => ({ error: { code: message === 'JWT expired' ? 'PGRST301' : '500', message }, data: null }) }) }); assert.equal(pillText(app), want, message); }
  const blocked = await boot({ role: 'cleaner', hash: '#home', handlers: baseHandlers('cleaner', { staff_home_v1: () => ({ error: null, data: Object.assign(HOMEWITH([]).data, { amount: 5 }) }) }) });
  assert.equal(pillText(blocked), 'Could not update'); assert.match(blocked.els['v-home'].innerHTML, /blocked/);
  const a = CS.E_attention({ role: 'cleaner', today: TODAY, error: true, errorKind: 'server', lastAt: '2026-10-15T04:34:00Z', ready: {} });
  assert.deepEqual([a.phase, a.pill.text, a.pill.aria], ['stale', 'Could not update', 'Could not update. Showing the last update from 12:34. Opens the list']);
  assert.equal(CS.E_attention({ role: 'cleaner', today: TODAY, error: true, ready: {} }).phase, 'offline', 'no kind given: the old behaviour');
});

// ------------------------------------------------------------------------------------------------ F3
test('E_fix F3: a Home redraw under the finger never lets the slide commit: travel is measured when the drag starts, a detached pill is a cancel', async () => {
  const app = await boot({ role: 'cleaner', hash: '#home', fold: FOLD, handlers: baseHandlers('cleaner', { staff_home_v1: () => HOMEWITH([stayRow('Ana Reyes', '2026-10-12', TODAY), stayRow('Ben Cruz', TODAY, '2026-10-18')]) }) });
  const knob = { style: {} }, a = surf({ offsetWidth: 300, querySelector: () => knob, getAttribute: (k) => (k === 'href' ? '#door/checklist' : null) });
  const pts = [[0, 40, 10], [60, 50, 12], [120, 60, 12], [200, 60, 12]], pick = (s, el) => (s === '[data-slide]' ? el : null);
  let width = 300; Object.defineProperty(a, 'offsetWidth', { get: () => width });
  const fire = (t, ev) => (app.listeners[t] || []).forEach((f) => f(ev)); const target = { closest: (s) => pick(s, a) };
  fire('pointerdown', { target, clientX: 40, clientY: 10, pointerId: 1, timeStamp: 0, button: 0 }); fire('pointermove', { clientX: 55, clientY: 12, pointerId: 1, timeStamp: 50 }); fire('pointermove', { clientX: 60, clientY: 12, pointerId: 1, timeStamp: 100 });
  width = 0; // the screen was redrawn: the old node reads 0
  fire('pointerup', { clientX: 60, clientY: 12, pointerId: 1, timeStamp: 120 });
  assert.equal(app.location.hash, '#home', 'a 20 px drag never opens the checklist');
  const dead = surf({ isConnected: false, offsetWidth: 300, querySelector: () => knob, getAttribute: (k) => (k === 'href' ? '#door/checklist' : null) });
  drive(app, dead, [[300, 40, 10], [360, 120, 12], [420, 290, 12], [480, 290, 12]], pick); assert.equal(app.location.hash, '#home', 'a node that is no longer on the page cancels every gesture, however far it was dragged');
});

// ------------------------------------------------------------------------------------------------ F4
test('E_fix F4: a warning sheet opened from the pill on Home stays open through a Home redraw and says "Marked as handled." after the ack', async () => {
  const w = { kind: 'verifier', title: 'Airbnb block runs past the last guest night', severity: 'alert', key: 'V1m:x', detail: {} };
  let acked = false;
  const app = await boot({ role: 'admin', hash: '#home', handlers: baseHandlers('admin', { staff_home_v1: () => HOMEWITH([], { warnings: acked ? [] : [w] }), tasks_list_v1: tasksOf([], true), ack_verifier_finding_v1: () => { acked = true; return { error: null, data: { ok: true } }; } }) });
  await app.click({ 'data-act': 'attn-open' }); await app.click({ 'data-warn': CS.E_warnKey(w) });
  assert.match(app.els['cs-body'].innerHTML, /Mark as handled/); assert.equal(app.els['cal-sheet'].getAttribute('aria-hidden'), 'false');
  await app.click({ 'data-act': 'refresh' }); assert.equal(app.els['cal-sheet'].getAttribute('aria-hidden'), 'false', 'a Home redraw does not close it');
  await app.click({ 'data-act': 'warn-ack' });
  assert.deepEqual(app.calls.filter((c) => c[0] === 'ack_verifier_finding_v1').map((c) => c[1]), [{ p_key: 'V1m:x' }]);
  assert.equal(app.els['cal-sheet'].getAttribute('aria-hidden'), 'false'); assert.match(app.els['cs-body'].innerHTML, /Marked as handled\./, 'the person sees it worked');
  // a sheet belongs to the screen it was opened on: leaving that screen closes it
  const cal = await boot({ role: 'admin', hash: '#calendar', handlers: baseHandlers('admin', { staff_home_v1: () => HOMEWITH([stayRow('Ana', '2026-10-14', '2026-10-17')]) }) });
  await cal.click({ 'data-day': '2026-10-16' }); assert.equal(cal.els['cal-sheet'].getAttribute('aria-hidden'), 'false');
  cal.location.hash = '#tasks'; for (const f of cal.winListeners.hashchange || []) f(); await cal.flush(); assert.equal(cal.els['cal-sheet'].getAttribute('aria-hidden'), 'true');
  // the day row in the pill opens the day sheet on the calendar and it stays there
  const dc = await boot({ role: 'admin', hash: '#home', handlers: baseHandlers('admin', { staff_home_v1: () => HOMEWITH([stayRow('Ana', '2026-10-20', '2026-10-24'), stayRow('Ben', '2026-10-22', '2026-10-25')]), tasks_list_v1: tasksOf([], true) }) });
  await dc.click({ 'data-act': 'attn-open' }); await dc.click({ 'data-act': 'notice-cal', 'data-date': '2026-10-22' });
  for (const f of dc.winListeners.hashchange || []) f(); await dc.flush(); assert.equal(dc.els['cal-sheet'].getAttribute('aria-hidden'), 'false', 'the day sheet survives the move to the calendar');
});

// ------------------------------------------------------------------------------------------------ F5
test('E_fix F5: the next pointerdown clears the click swallow, and a lost pointerup never leaves a gesture dead', async () => {
  let now = 1000; CS.E_setClock(() => now);
  try {
    const a = surf({ offsetWidth: 300, querySelector: () => ({ style: {} }), getAttribute: () => null, closest: () => null, href: '#door/checklist' });
    const app = await boot({ role: 'cleaner', hash: '#home', handlers: baseHandlers('cleaner') });
    const fire = (t, ev) => (app.listeners[t] || []).forEach((f) => f(ev)); const hit = { closest: (s) => (s === '[data-slide]' ? a : null) };
    const click = (t) => { let p = 0; fire('click', { target: t, preventDefault() { p++; }, stopPropagation() {} }); return p; };
    const drag = (t0) => { fire('pointerdown', { target: hit, button: 0, clientX: 40, clientY: 10, pointerId: 1, timeStamp: t0 }); fire('pointermove', { clientX: 100, clientY: 12, pointerId: 1, timeStamp: t0 + 90 }); fire('pointerup', { clientX: 100, clientY: 12, pointerId: 1, timeStamp: t0 + 100 }); };
    drag(0); fire('pointerdown', { target: { closest: () => null }, button: 0, clientX: 5, clientY: 5, pointerId: 2, timeStamp: 150 }); assert.equal(click(a), 0, 'a real tap right after the drag is not eaten');
    drag(200); now += 200; assert.equal(click(a), 1, 'but the click that IS the tail of the drag is still swallowed'); now += 500; drag(900); now += 450; assert.equal(click(a), 0, 'and not after 400 ms (frozen clock)');
    // a pointerup that never came: the next touch starts over
    const knob = { style: {} }; a.querySelector = () => knob; fire('pointerdown', { target: hit, button: 0, clientX: 40, clientY: 10, pointerId: 7, timeStamp: 2000 }); fire('pointermove', { clientX: 90, clientY: 12, pointerId: 7, timeStamp: 2050 });
    knob.style.transform = ''; fire('pointerdown', { target: hit, button: 0, clientX: 40, clientY: 10, pointerId: 8, isPrimary: true, timeStamp: 3000 }); fire('pointermove', { clientX: 100, clientY: 12, pointerId: 8, timeStamp: 3050 });
    assert.match(knob.style.transform, /translateX\(60px\)/, 'the new touch follows the finger');
  } finally { CS.E_setClock(null); }
});

// ------------------------------------------------------------------------------------------------ F6
test('E_fix F6: a note being typed on a day is never lost to a pull; the dirty kinds are the reminder, notice, rate and day-note sheets', async () => {
  const cal = [stayRow('Ana Reyes', '2026-10-14', '2026-10-17')];
  const open = async () => { const app = await boot({ role: 'admin', hash: '#calendar', handlers: baseHandlers('admin', { staff_home_v1: () => HOMEWITH(cal) }) }); await app.click({ 'data-day': '2026-10-16' }); return app; };
  const pull = (app) => { const sh = app.els['cal-sheet']; drive(app, sh, [[0, 180, 300], [30, 180, 340], [60, 180, 380], [90, 180, 410], [400, 180, 410]], (s) => (s === '#cal-sheet' ? sh : s === '.E_grab' ? {} : null)); };
  const shut = (app) => app.els['cal-sheet'].getAttribute('aria-hidden') === 'true';
  const typed = await open(); await typed.click({ 'data-act': 'dayform-open' }); typed.input('df-label', 'Plumber coming at 9'); pull(typed); assert.ok(!shut(typed), 'text typed: the sheet springs back');
  const closed = await open(); await closed.click({ 'data-act': 'dayform-open' }); pull(closed); assert.ok(shut(closed), 'form open but empty: closes');
  const plain = await open(); pull(plain); assert.ok(shut(plain), 'no form: closes');
  const live = await open(); await live.click({ 'data-act': 'dayform-open' }); live.els['df-label'] = { value: 'typed, not yet synced' }; pull(live); assert.ok(!shut(live), 'the live field is read too, not only the synced state');
  const src = read('app.js'); assert.match(src, /if \(S\.kind === 'day'\) \{ var fld = \$\('df-label'\)/); for (const k of ["'add'", "'nadd'", "'rate'"]) assert.ok(src.includes("S.kind === " + k + ") return !!("), k + ' is dirty-aware');
});

// ------------------------------------------------------------------------------------------------ F7
test('E_fix F7: a failed save replaces the Undo toast with the plain error and brings the row back; Done on Home redraws no Tasks screen; in demo the real toast is shown', async () => {
  const fail = await boot({ role: 'admin', hash: '#tasks', handlers: baseHandlers('admin', { tasks_list_v1: tasksOf([T({})], true), task_set_done_v1: () => ({ error: { code: '500', message: 'x' }, data: null }) }) });
  await fail.click({ 'data-act': 'task-done', 'data-task': 'follow_up_tasks:a' });
  assert.equal(fail.els['cs-toast'].textContent, 'That did not save. Check your signal and try again.'); assert.equal(fail.els['cs-toast'].innerHTML, ''); assert.match(fail.els['v-tasks'].innerHTML, /data-act="task-done" data-task="follow_up_tasks:a"/, 'the row is back');
  const src = read('app.js'); assert.match(src, /if \(current === 'tasks'\) renderTasks\(\); renderTabs\(current\);/);
  const onHome = await boot({ role: 'admin', hash: '#home', handlers: baseHandlers('admin', { staff_home_v1: home(), tasks_list_v1: tasksOf([T({})], true), task_set_done_v1: () => ({ error: null, data: { ok: true } }) }) });
  const before = onHome.els['v-tasks'].innerHTML; await onHome.click({ 'data-act': 'task-done', 'data-task': 'follow_up_tasks:a' }); assert.equal(onHome.els['v-tasks'].innerHTML, before, 'the hidden Tasks screen was not redrawn from Home');
  assert.match(onHome.els.tabbar.innerHTML, /href="#home" aria-current="page"/, 'and the tab bar keeps the current tab');
  const demo = await boot({ role: 'admin', hash: '#tasks', demo: true, handlers: baseHandlers('admin', { tasks_list_v1: tasksOf([T({})], true), task_set_done_v1: () => ({ error: null, data: { ok: true } }) }) });
  await demo.click({ 'data-act': 'task-done', 'data-task': 'follow_up_tasks:a' });
  assert.match(demo.els['cs-toast'].innerHTML, /<span>Marked done<br><span class="help">Demo: nothing was saved<\/span><\/span><button class="btn btn-ghost btn-sm E_toastbtn" type="button" data-act="task-undo"/, 'the real toast with its Undo; the demo note is the sub-line');
});

// ------------------------------------------------------------------------------------------------ F8
test('E_fix F8: every sheet has a 44 px Close in a sticky header (glyph and word), and no sheet ends in a Close that can fall under the fold', async () => {
  const cal = [stayRow('Ana Reyes', '2026-10-14', '2026-10-17')];
  const sheets = [];
  const day = await boot({ role: 'admin', hash: '#calendar', handlers: baseHandlers('admin', { staff_home_v1: () => HOMEWITH(cal) }) }); await day.click({ 'data-day': '2026-10-16' }); sheets.push(['day', day, 'sheet-close']);
  await day.click({ 'data-act': 'dayform-open' }); sheets.push(['day with the form open', day, 'sheet-close']);
  const attn = await boot({ role: 'admin', hash: '#home', handlers: baseHandlers('admin', { staff_home_v1: home(), tasks_list_v1: tasksOf([T({ blocks_arrival: true })], true) }) }); await attn.click({ 'data-act': 'attn-open' }); sheets.push(['attn', attn, 'sheet-close']);
  const news = await boot({ role: 'cleaner', hash: '#more', handlers: baseHandlers('cleaner') }); await news.click({ 'data-act': 'whatsnew' }); sheets.push(['news', news, 'sheet-close']);
  const add = await boot({ role: 'admin', hash: '#tasks', handlers: baseHandlers('admin', { tasks_list_v1: tasksOf([], true) }) }); await add.click({ 'data-act': 'task-add-open' }); sheets.push(['add', add, 'task-add-cancel']);
  const nadd = await boot({ role: 'admin', hash: '#calendar', handlers: baseHandlers('admin') }); await nadd.click({ 'data-act': 'notice-add-open', 'data-date': TODAY }); sheets.push(['nadd', nadd, 'notice-add-cancel']);
  for (const [name, app, act] of sheets) {
    const b = app.els['cs-body'].innerHTML; assert.match(b, /^<div class="F_sheethead"><h2 class="ttl"[^>]*>[^]*?<\/h2><button class="btn btn-secondary btn-sm F_close" type="button" data-F-close="1" data-act="/, name + ': the header row is title + Close'); assert.ok(b.includes('data-act="' + act + '"><svg'), name);
    assert.match(b.slice(0, 260), /Close<\/button><\/div>/, name); assert.doesNotMatch(b, /btn-block" type="button" data-act="sheet-close" style="margin-top:12px">Close/, name + ': no Close at the very end');
  }
  assert.match(css, /\.F_sheethead \{ position: sticky; top: 0; z-index: 4; display: flex;[^}]*background: var\(--v5-surf\); \}/); assert.match(css, /\.F_close \{ flex: none; margin-left: auto; \}/); assert.match(css, /\.btn-sm \{ min-height: var\(--touch\);/);
  assert.match(css, /\.F_sheethead h2 \{ flex: 1; min-width: 0;/, 'a long title wraps beside Close, never under it');
});

// ------------------------------------------------------------------------------------------------ F9
test('E_fix F9: leaving a door reloads Home and Tasks, so the pill is not stale after what was done inside', async () => {
  let door = 'dashboard/';
  const frame = { attrs: { 'data-door': door }, getAttribute(k) { return this.attrs[k] ?? null; }, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; }, contentWindow: null, src: '' };
  const app = await boot({ role: 'admin', hash: '#home', els: { 'door-frame': Object.assign({}, frame, { attrs: {} }) }, handlers: baseHandlers('admin', { staff_home_v1: home(), tasks_list_v1: tasksOf([], true) }) });
  const n = (name) => app.calls.filter((c) => c[0] === name).length, h0 = n('staff_home_v1'), t0 = n('tasks_list_v1');
  app.els['door-frame'].attrs['data-door'] = door; app.location.hash = '#home'; for (const f of app.winListeners.hashchange || []) f(); await app.flush();
  assert.equal(n('staff_home_v1'), h0 + 1); assert.equal(n('tasks_list_v1'), t0 + 1);
  for (const f of app.winListeners.hashchange || []) f(); await app.flush(); assert.equal(n('staff_home_v1'), h0 + 1, 'no door was open: no reload');
});

// ------------------------------------------------------------------------------------------------ F11
test('E_fix F11: touch-action keeps pinch-zoom, the grab strip is 28 px, the hidden Undo is out of the Tab order, reduced motion keeps the follow and drops the spring-back', async () => {
  assert.match(css, /\.E_tabbody \{ touch-action: pan-y pinch-zoom; \}/); assert.match(css, /\.E_swipewrap \.payrow \{[^}]*touch-action: pan-y pinch-zoom;/); assert.match(css, /\.A_slide \{[^}]*touch-action: pan-y pinch-zoom;/); assert.doesNotMatch(css, /touch-action: pan-y;/);
  assert.match(css, /\.E_grab \{ position: sticky; top: 0; z-index: 3; height: 28px; margin: -16px -16px -12px; touch-action: none; \}/);
  const gone = new Set(), app = await boot({ role: 'admin', hash: '#tasks', handlers: baseHandlers('admin', { tasks_list_v1: () => tasksOf([T({})].filter((t) => !gone.has(t.id)), true)(), task_set_done_v1: (a) => { gone.add(a.p_id); return { error: null, data: { ok: true } }; } }) });
  await app.click({ 'data-act': 'task-done', 'data-task': 'follow_up_tasks:a' }); assert.match(app.els['v-tasks'].innerHTML, /<div class="okbox sr" role="status">[^]*<button class="btn btn-ghost btn-sm" type="button" data-act="task-undo"[^>]*tabindex="-1">Undo<\/button>/);
  // reduced motion: the knob still follows, and comes back with no transition
  const knob = { style: {} }, a = surf({ offsetWidth: 300, querySelector: () => knob, getAttribute: (k) => (k === 'href' ? '#door/checklist' : null) });
  const r = await boot({ role: 'cleaner', hash: '#home', reduced: true, handlers: baseHandlers('cleaner') }); const moves = [];
  Object.defineProperty(knob.style, 'transform', { set(v) { moves.push(v); }, get() { return moves.at(-1) || ''; } });
  drive(r, a, [[0, 40, 10], [50, 70, 12], [100, 100, 12], [150, 100, 12]], (s, el) => (s === '[data-slide]' ? el : null));
  assert.deepEqual(moves.filter(Boolean), ['translateX(30px)', 'translateX(60px)'], 'follows the finger 1:1'); assert.equal(knob.style.transition, 'none', 'and returns instantly');
  // one time format in the pill's sheet
  const w = { kind: 'brownout', title: 'SOCOTECO II', detail: { date: '2026-10-16', time: '13:00', hours: 3 } };
  const b = CS.E_attention({ role: 'admin', today: TODAY, ready: { payload: true, tasks: true, bookings: true, notices: true }, warnings: [w] });
  assert.equal(b.sections[0].rows[0].title, 'Brownout Fri 16 Oct, 1:00 to 4:00 pm'); assert.doesNotMatch(b.sections[0].rows[0].title, /13:00|3 h/);
  const e = CS.E_attention({ role: 'admin', today: TODAY, ready: { payload: true, tasks: true, bookings: true, notices: true }, warnings: [{ kind: 'brownout', title: 'x', detail: { date: '2026-10-16', time: '22:00', hours: 5 } }] });
  assert.equal(e.sections[0].rows[0].title, 'Brownout Fri 16 Oct, 10:00 pm', 'past midnight: the start only, never a wrong end');
});
test('E_fix F11: an announce armed by a Refresh tap ends with the load it was armed for (a later background load stays quiet; a tap during a load arms nothing)', async () => {
  const app = await boot({ role: 'cleaner', hash: '#home', handlers: baseHandlers('cleaner', { staff_home_v1: home(), tasks_list_v1: tasksOf([T({ due_at: '2026-10-15T09:00:00Z' })]) }) });
  await app.click({ 'data-act': 'refresh' }); assert.equal(app.els['E_attn-live'].textContent, '1 thing to look at');
  app.els['E_attn-live'].textContent = ''; for (const f of app.listeners.visibilitychange || []) f(); await app.flush(); assert.equal(app.els['E_attn-live'].textContent, '', 'a background reload announces nothing');
  const slow = await boot({ role: 'cleaner', hash: '#home', handlers: baseHandlers('cleaner', { staff_home_v1: () => new Promise(() => {}) }) });
  await slow.click({ 'data-act': 'refresh' }); assert.equal((slow.els['E_attn-live'] || {}).textContent || '', '');
});

// ------------------------------------------------------------------------------------------------ the first-paint dashboard link
test('E_fix: until the fold manifest answers the bookings row and the pill row link to the in-app door; only a manifest WITHOUT a dashboard (or a failed fetch) falls back to the stand-alone URL', async () => {
  const handlers = baseHandlers('admin', { staff_home_v1: home(), tasks_list_v1: tasksOf([], true), staff_inquiry_payments_v1: () => ({ error: null, data: [{ id: 'b1' }] }) });
  const old = /cascade-admin-dashboard|github\.io/;
  const pending = await boot({ role: 'admin', hash: '#home', foldFetch: () => new Promise(() => {}), handlers });
  let h = pending.els['v-home'].innerHTML; assert.match(h, /href="#door\/dashboard\/bookings\/inquiries"/); assert.doesNotMatch(h, old, 'no flash of the old address on first paint');
  await pending.click({ 'data-act': 'attn-open' }); assert.match(pending.els['cs-body'].innerHTML, /href="#door\/dashboard\/bookings\/inquiries"/); assert.doesNotMatch(pending.els['cs-body'].innerHTML, old);
  const without = await boot({ role: 'admin', hash: '#home', fold: { schema: 1, surfaces: { checklist: { files: 8 } } }, handlers });
  assert.match(without.els['v-home'].innerHTML, /cascade-admin-dashboard\/#\/bookings\/inquiries/, 'a resolved manifest without a dashboard: the stand-alone page');
  const failed = await boot({ role: 'admin', hash: '#home', foldFetch: () => Promise.reject(new Error('offline')), handlers });
  assert.match(failed.els['v-home'].innerHTML, /cascade-admin-dashboard\/#\/bookings\/inquiries/, 'a failed fetch: the stand-alone page');
  const folded = await boot({ role: 'admin', hash: '#home', fold: FOLD, handlers }); assert.doesNotMatch(folded.els['v-home'].innerHTML, old); assert.match(folded.els['v-home'].innerHTML, /href="#door\/dashboard\/bookings\/inquiries"/);
});

// ------------------------------------------------------------------------------------------------ the tap twins, behaviourally
test('E_fix: the tap twin of G1, G2 and G4 does the same thing as the gesture (same resulting state), not just "a control exists"', async () => {
  const cal = await boot({ role: 'admin', hash: '#calendar', handlers: baseHandlers('admin', { staff_home_v1: () => HOMEWITH([stayRow('Ana Reyes', '2026-10-14', '2026-10-17')]) }) });
  const link = /<a href="(#calendar\/stays)" data-act="cal-tab" data-tab="stays"/.exec(cal.els['v-calendar'].innerHTML)[1];
  const body = surf(); drive(cal, body, [[0, 300, 300], [100, 250, 302], [200, 150, 302], [260, 150, 302]], (s, el) => (s === '.E_tabbody' ? el : null)); assert.equal(cal.location.hash, link, 'swiping to Stays lands where the Stays tab link goes');
  const state = async (how) => { const app = await boot({ role: 'admin', hash: '#tasks', handlers: baseHandlers('admin', { tasks_list_v1: tasksOf([], true) }) }); await app.click({ 'data-act': 'task-add-open' });
    if (how === 'pull') { const sh = app.els['cal-sheet']; drive(app, sh, [[0, 180, 100], [20, 180, 200], [40, 180, 320], [60, 180, 400]], (s) => (s === '#cal-sheet' ? sh : s === '.E_grab' ? {} : null)); } else await app.click({ 'data-act': app.els['cal-sheet'].getAttribute('data-E-swipe') });
    await app.click({ 'data-act': 'task-add-open' }); return [app.els['cal-sheet'].getAttribute('aria-hidden'), /id="t-title" maxlength="200" value=""/.test(app.els['cs-body'].innerHTML)]; };
  assert.deepEqual(await state('pull'), await state('button'), 'a pulled-down reminder sheet and a cancelled one end in the same state (closed, nothing kept)');
  const FOLDED = { schema: 1, surfaces: { checklist: { files: 8 }, admin: { files: 1 } } }, tw = { knob: { style: {} } };
  const home2 = await boot({ role: 'cleaner', hash: '#home', fold: FOLDED, handlers: baseHandlers('cleaner', { staff_home_v1: () => HOMEWITH([stayRow('Ana', '2026-10-12', TODAY), stayRow('Ben', TODAY, '2026-10-18')]) }) });
  const href = /<a class="A_slide" data-slide href="([^"]+)"/.exec(home2.els['v-home'].innerHTML)[1];
  drive(home2, surf({ offsetWidth: 300, querySelector: () => tw.knob, getAttribute: (k) => (k === 'href' ? href : null) }), [[0, 40, 10], [100, 150, 12], [200, 290, 12], [300, 290, 12]], (s, el) => (s === '[data-slide]' ? el : null));
  assert.equal(home2.location.hash, href, 'the slide goes where a tap on the pill goes');
});
