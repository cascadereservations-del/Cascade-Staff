// Lane E: the four gestures (G1 calendar views, G2 sheet pull-down, G3 task row, G4 slide to start), all through CS.E_drag, each with a tap twin and a keyboard path.
// Pointer events are simulated with explicit time stamps (no real clock), in a fake DOM: element stand-ins record their style and class changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CS, read, boot, HOMEWITH, baseHandlers, stayRow, TODAY } from './_a_harness.mjs';

const T = (o) => Object.assign({ source: 'follow_up_tasks', id: 'a', kind: 'reminder', title: 'Water the plants', priority: 'normal', status: 'open', due_at: '2026-10-12T09:00:00Z', mine: true, blocks_arrival: false, detail: null, assignee_label: null, created_at: '2026-10-01T00:00:00Z' }, o);
const vib = () => { const calls = []; return { calls, vibrate: (p) => { calls.push(p); return true; } }; };
const tasksOf = (list, manager) => () => ({ error: null, data: { ok: true, manager: !!manager, today: TODAY, tasks: list } });

// A drag as a list of [t, x, y] points. down at the first, up at the last.
function drive(app, surface, pts, o) {
  o = o || {}; const fire = (t, ev) => { for (const fn of app.listeners[t] || []) fn(ev); };
  const target = { closest: (sel) => (o.pick ? o.pick(sel) : sel === o.sel ? surface : null) };
  pts.forEach((p, i) => {
    const ev = { clientX: p[1], clientY: p[2], pointerId: o.id || 1, timeStamp: p[0], button: 0 };
    if (i === 0) fire('pointerdown', Object.assign(ev, { target, button: o.button || 0 }));
    else fire(i === pts.length - 1 ? 'pointerup' : 'pointermove', ev);
  });
}
const surf = (extra) => Object.assign({ style: {}, offsetWidth: 360, offsetHeight: 400, scrollTop: 0, parentNode: { classList: { add() {}, remove() {}, contains: () => false }, style: {} }, classList: { add() {}, remove() {}, contains: () => false },
  getAttribute: () => null, setAttribute() {}, querySelector: () => null, contains(t) { return t === this; }, setPointerCapture() {} }, extra || {});

// ---------------------------------------------------------------------------------------------------- the helper
test('E_drag numbers (s82): lock at 10 px on the browser\'s own 45 degrees, a 24 px edge zone (12 px on the right for task rows), velocity over the last 100 ms', () => {
  assert.equal(CS.E_lockOf(11, 0), 'x'); assert.equal(CS.E_lockOf(10, 0), '', '10 is not past 10'); assert.equal(CS.E_lockOf(0, 11), 'y'); assert.equal(CS.E_lockOf(-20, 0), 'x');
  assert.equal(CS.E_lockOf(20, 14), 'x', 'a 35 degree thumb arc is a swipe now (it was a dead band)'); assert.equal(CS.E_lockOf(20, 20), '', '45 degrees exactly is neither'); assert.equal(CS.E_lockOf(21, 20), 'x'); assert.equal(CS.E_lockOf(14, 30), 'y');
  assert.equal(CS.E_inEdge(23, 360), true); assert.equal(CS.E_inEdge(24, 360), false); assert.equal(CS.E_inEdge(336, 360), false); assert.equal(CS.E_inEdge(337, 360), true);
  assert.equal(CS.E_inEdge(348, 360, 24, CS.E_EDGE_R_TASK), false, 'a task row may start 12 px from the right edge'); assert.equal(CS.E_inEdge(349, 360, 24, CS.E_EDGE_R_TASK), true); assert.equal(CS.E_inEdge(23, 360, 24, CS.E_EDGE_R_TASK), true, 'the left edge stays 24');
  assert.deepEqual(CS.E_velocity([{ t: 0, x: 0, y: 0 }, { t: 50, x: 25, y: 0 }, { t: 100, x: 100, y: 0 }]), { vx: 1, vy: 0 }, 'the last 100 ms count: from t = 0');
  assert.deepEqual(CS.E_velocity([{ t: 0, x: 0, y: 0 }, { t: 150, x: 50, y: 0 }, { t: 200, x: 100, y: 0 }]), { vx: 1, vy: 0 }, 'only from t = 150 back to 100 ms: from t = 150 is 50 px in 50 ms');
  assert.deepEqual(CS.E_velocity([{ t: 0, x: 0, y: 0 }]), { vx: 0, vy: 0 });
  assert.deepEqual(CS.E_velocity([{ t: 5, x: 0, y: 0 }, { t: 5, x: 9, y: 0 }]), { vx: 0, vy: 0 }, 'no time, no velocity');
});

test('E_drag numbers (s82): every commit rule from the audit 5.3', () => {
  assert.equal(CS.E_tabCommit(-64, 360, 0), true); assert.equal(CS.E_tabCommit(-63, 360, 0), false, 'min(20% of the width, 64 px)'); assert.equal(CS.E_tabCommit(-39, 200, 0), false, '20% of 200 is 40');
  assert.equal(CS.E_tabCommit(-40, 200, 0), true); assert.equal(CS.E_tabCommit(-32, 360, -0.3), true); assert.equal(CS.E_tabCommit(-32, 360, -0.29), false); assert.equal(CS.E_tabCommit(-31, 360, -2), false, 'a flick needs a 32 px floor'); assert.equal(CS.E_tabCommit(-32, 360, 0.5), false, 'and only the way the finger went');
  assert.equal(CS.E_tabFollow(-100), -60); assert.equal(CS.E_tabFollow(-300), -96, 'followed at 0.6 and clamped to 96');
  assert.equal(CS.E_sheetCommit(80, 0), true); assert.equal(CS.E_sheetCommit(79, 0.39), false); assert.equal(CS.E_sheetCommit(40, 0.4), true); assert.equal(CS.E_sheetCommit(39, 5), false, 'a flick needs a 40 px floor');
  assert.equal(CS.E_sheetFollow(50), 50, '1:1 downward'); assert.equal(CS.E_sheetFollow(-40), -8, 'upward damped by 0.2'); assert.equal(CS.E_sheetFollow(-200), -16, 'and capped at 16 px');
  assert.equal(CS.E_taskCommit(-110, 360, 0), true); assert.equal(CS.E_taskCommit(-109, 360, 0), false, 'min(33% of the row, 110 px)'); assert.equal(CS.E_taskDist(200), 66); assert.equal(CS.E_taskCommit(-40, 360, -0.35), true); assert.equal(CS.E_taskCommit(-39, 360, -9), false, 'a flick needs a 40 px floor'); assert.equal(CS.E_taskCommit(60, 360, 0.9), false, 'a swipe the other way is nothing');
  assert.equal(CS.E_taskFollow(-60, 96), 60); assert.equal(CS.E_taskFollow(-196, 96), 96 + 100 * 0.25, 'past the underlay it is damped'); assert.equal(CS.E_taskFollow(40, 96), 0);
  assert.equal(CS.E_taskOpens(-49), true); assert.equal(CS.E_taskOpens(-48), false);
  assert.equal(CS.E_slideCommit(70, 100, 0), true); assert.equal(CS.E_slideCommit(69, 100, 0.59), false); assert.equal(CS.E_slideCommit(40, 100, 0.6), true); assert.equal(CS.E_slideCommit(39, 100, 2), false, 'a fast flick needs 40% of the travel first');
  assert.deepEqual(CS.A_CAL_TABS, ['calendar', 'notices']); assert.equal(CS.E_tabNeighbour('calendar', -1), null); assert.equal(CS.E_tabNeighbour('calendar', 1), 'notices'); assert.equal(CS.E_tabNeighbour('notices', 1), null, 'no wrap'); assert.equal(CS.E_tabNeighbour('notices', -1), 'calendar');
});

function fakeRoot() { const l = {}; return { l, addEventListener: (t, fn) => { (l[t] ||= []).push(fn); }, fire: (t, ev) => (l[t] || []).forEach((f) => f(ev)) }; }
function helper(over) {
  const root = fakeRoot(), log = [], el = surf(), seen = [];
  const h = CS.E_drag(root, Object.assign({ sel: 'S', axis: 'x', vw: () => 360, reduced: () => false, start: () => log.push('start'), move: (e, d) => log.push(['move', d.dx]), reached: (e, d) => d.dx >= 100, onEdge: () => log.push('edge'), end: (e, d) => seen.push(d), cancel: () => log.push('cancel') }, over || {}));
  const down = (x, y, id, button) => root.fire('pointerdown', { target: { closest: (s) => (s === 'S' ? el : null) }, clientX: x, clientY: y, pointerId: id == null ? 1 : id, timeStamp: 0, button: button || 0 });
  const mv = (x, y, t, id) => root.fire('pointermove', { clientX: x, clientY: y, pointerId: id == null ? 1 : id, timeStamp: t });
  const up = (x, y, t, id) => root.fire('pointerup', { clientX: x, clientY: y, pointerId: id == null ? 1 : id, timeStamp: t });
  return { root, log, el, seen, h, down, mv, up };
}

test('E_drag: nothing moves before the lock; the other direction is left to the page; a horizontal drag follows once locked', () => {
  const a = helper(); a.down(100, 100); a.mv(105, 100, 10); a.mv(109, 101, 20); assert.deepEqual(a.log, [], 'under 10 px: nothing moves, nothing starts');
  a.mv(120, 101, 30); assert.deepEqual(a.log, ['start', ['move', 20]]); a.up(120, 101, 40); assert.equal(a.seen.length, 1);
  const v = helper(); v.down(100, 100); v.mv(104, 130, 10); v.mv(110, 160, 20); v.up(110, 160, 30);
  assert.deepEqual(v.log, [], 'a vertical drag on a horizontal surface is the page scrolling: never started'); assert.equal(v.seen.length, 0, 'and never ends'); assert.equal(v.h.busy(), false);
});

test('E_drag: a drag that starts inside 24 px of either screen edge is ignored (the system back swipe), a second finger is ignored, a non-main button is ignored', () => {
  for (const x of [10, 23, 337, 350]) { const a = helper(); a.down(x, 100); a.mv(x + 40, 100, 10); a.up(x + 40, 100, 20); assert.deepEqual(a.log, [], 'x = ' + x); assert.equal(a.seen.length, 0); }
  const ok = helper(); ok.down(24, 100); ok.mv(60, 100, 10); assert.deepEqual(ok.log, ['start', ['move', 36]], 'x = 24 is just outside');
  const two = helper(); two.down(100, 100, 1); two.root.fire('pointerdown', { target: { closest: () => two.el }, clientX: 200, clientY: 200, pointerId: 2, isPrimary: false, timeStamp: 0, button: 0 }); two.mv(150, 100, 10, 2); assert.deepEqual(two.log, [], 'the second finger moves nothing'); two.mv(130, 100, 10, 1); assert.equal(two.log[0], 'start');
  two.up(130, 100, 20, 2); assert.equal(two.seen.length, 0, 'and cannot end the first finger\'s drag'); two.up(130, 100, 30, 1); assert.equal(two.seen.length, 1);
  const btn = helper(); btn.down(100, 100, 1, 2); btn.mv(160, 100, 10); assert.deepEqual(btn.log, []);
  const tr = helper({ edgeR: CS.E_EDGE_R_TASK }); tr.down(340, 100); tr.mv(300, 100, 10); assert.equal(tr.log[0], 'start', 'a task row may start 20 px from the right edge'); const tr2 = helper({ edgeR: CS.E_EDGE_R_TASK }); tr2.down(350, 100); tr2.mv(300, 100, 10); assert.deepEqual(tr2.log, [], 'but not 10 px from it');
  // the sheet is vertical: the edge zone is about left and right, so it does not apply
  const sheet = helper({ axis: 'y' }); sheet.down(5, 100); sheet.mv(5, 140, 10); assert.equal(sheet.log[0], 'start');
});

test('E_drag: the edge buzz fires once per drag and again after the finger went back under; a cancel (the page took the scroll) ends it quietly', () => {
  const a = helper(); a.down(100, 100); a.mv(150, 100, 10); a.mv(200, 100, 20); a.mv(210, 100, 30);
  assert.equal(a.log.filter((x) => x === 'edge').length, 1, 'once at the threshold'); a.mv(150, 100, 40); a.mv(200, 100, 50); assert.equal(a.log.filter((x) => x === 'edge').length, 2, 're-armed after going back under');
  a.root.fire('pointercancel', { pointerId: 1 }); assert.equal(a.log.at(-1), 'cancel'); assert.equal(a.seen.length, 0); assert.equal(a.h.busy(), false);
});

test('E_drag: reduced motion keeps the 1:1 follow (a control that does not move under the finger feels broken); the drag ends with the same numbers', () => {
  const a = helper({ reduced: () => true }); a.down(100, 100); a.mv(160, 100, 10); a.mv(260, 100, 20); a.up(260, 100, 30);
  assert.deepEqual(a.log.filter((x) => Array.isArray(x)).map((x) => x[1]), [60, 160], 'the finger is followed'); assert.equal(a.seen.length, 1); assert.equal(a.seen[0].dx, 160); assert.ok(a.seen[0].vx > 0);
});

test('E_drag (s82): a pause before lifting does not zero a deliberate swipe (the lift is not a velocity sample), and a 35 degree arc locks', () => {
  const a = helper(); a.down(100, 100); a.mv(120, 110, 10); a.mv(150, 120, 20); a.up(151, 121, 140);
  assert.ok(a.seen[0].vx >= 1.5, 'the swipe was fast until the pause: ' + a.seen[0].vx); assert.equal(a.log[0], 'start', '20 px across, 10 px down is a swipe');
});

test('E_drag: the click that follows a drag is swallowed on that surface for 400 ms, once', async () => {
  let now = 0; CS.E_setClock(() => now);
  const a = helper(); a.down(100, 100); a.mv(150, 100, 10); a.up(150, 100, 20);
  let n = 0; const ev = (t) => ({ target: t, preventDefault() { n++; }, stopPropagation() {} });
  a.root.fire('click', ev({ contains: () => false })); assert.equal(n, 0, 'a click on something else');
  a.root.fire('click', ev(a.el)); assert.equal(n, 1); a.root.fire('click', ev(a.el)); assert.equal(n, 1, 'only once');
  const b = helper(); b.down(100, 100); b.mv(150, 100, 10); b.up(150, 100, 20); now = 450; b.root.fire('click', ev(b.el)); assert.equal(n, 1, 'and not after 400 ms (frozen clock)'); CS.E_setClock(null);
});

// ---------------------------------------------------------------------------------------------------- G2 sheet pull-down
async function openDay(role, o) {
  const cal = [stayRow('Ana Reyes', '2026-10-14', '2026-10-17')];
  const app = await boot(Object.assign({ role, hash: '#calendar', handlers: baseHandlers(role, { staff_home_v1: () => HOMEWITH(cal), tasks_list_v1: tasksOf([T({})], role !== 'cleaner') }) }, o || {}));
  await app.click({ 'data-day': '2026-10-16' }); return app;
}
const pullSheet = (app, pts, o) => { const sh = app.els['cal-sheet']; drive(app, sh, pts, Object.assign({ pick: (s) => (s === '#cal-sheet' ? sh : s === '.E_grab, .F_sheethead' ? ((o && o.grab) === false ? null : {}) : null) }, o || {})); return sh; };
const shut = (app) => app.els['cal-sheet'].getAttribute('aria-hidden') === 'true';

test('E_ G2: pulling the sheet down 80 px closes it; the buzz at 80, one tap twin on the sheet itself', async () => {
  const v = vib(), app = await openDay('admin', { nav: v });
  assert.equal(app.els['cal-sheet'].getAttribute('data-E-swipe'), 'sheet-close'); assert.match(app.els['cs-body'].innerHTML, /data-act="sheet-close"/);
  const sh = pullSheet(app, [[0, 180, 300], [30, 180, 340], [60, 180, 380], [90, 180, 400], [400, 180, 400]]);
  assert.ok(shut(app), 'closed'); assert.equal(sh.style.transform, '', 'the inline pull is handed back to the stylesheet'); assert.deepEqual(v.calls, [[6]], 'one edge buzz at 80 px');
});

test('E_ G2: a short slow pull springs back and leaves the sheet open; a fast flick closes it', async () => {
  const slow = await openDay('admin'); const sh = pullSheet(slow, [[0, 180, 300], [200, 180, 330], [400, 180, 365], [800, 180, 372]]);
  assert.ok(!shut(slow), 'open'); assert.equal(sh.style.transform, ''); assert.equal(sh.style.transition, '');
  const fast = await openDay('admin'); pullSheet(fast, [[0, 180, 300], [20, 180, 322], [40, 180, 346], [60, 180, 360]]); assert.ok(shut(fast), '60 px at 1 px/ms');
});

test('E_ G2: the sheet follows the finger 1:1 down and damped up, and the scrim fades with the pull', async () => {
  const app = await openDay('admin'); const sh = app.els['cal-sheet'], scrim = app.els['cal-scrim'] || (app.els['cal-scrim'] = { style: {} });
  const fire = (t, ev) => (app.listeners[t] || []).forEach((f) => f(ev));
  fire('pointerdown', { target: { closest: (s) => (s === '#cal-sheet' ? sh : s === '.E_grab, .F_sheethead' ? {} : null) }, clientX: 180, clientY: 300, pointerId: 1, timeStamp: 0, button: 0 });
  fire('pointermove', { clientX: 180, clientY: 340, pointerId: 1, timeStamp: 100 }); assert.equal(sh.style.transform, 'translateY(40px)'); assert.equal(sh.style.transition, 'none');
  assert.ok(+scrim.style.opacity < 1 && +scrim.style.opacity > 0.8, 'the scrim fades: ' + scrim.style.opacity);
  fire('pointermove', { clientX: 180, clientY: 250, pointerId: 1, timeStamp: 200 }); assert.equal(sh.style.transform, 'translateY(-10px)');
  fire('pointerup', { clientX: 180, clientY: 250, pointerId: 1, timeStamp: 210 });
});

test('E_ G2: a form with something typed in it never closes on a pull; its Cancel still does; an empty one closes like Cancel', async () => {
  const app = await boot({ role: 'admin', hash: '#tasks', handlers: baseHandlers('admin', { tasks_list_v1: tasksOf([T({})], true) }) });
  await app.click({ 'data-act': 'task-add-open' });
  assert.equal(app.els['cal-sheet'].getAttribute('data-E-swipe'), 'task-add-cancel'); assert.match(app.els['cs-body'].innerHTML, /data-act="task-add-cancel"/);
  app.input('t-title', 'Buy light bulbs');
  const sh = pullSheet(app, [[0, 180, 100], [20, 180, 200], [40, 180, 320], [60, 180, 400]]);
  assert.ok(!shut(app), 'dirty: it springs back'); assert.equal(sh.style.transform, '');
  await app.click({ 'data-act': 'task-add-cancel' }); assert.ok(shut(app), 'Cancel keeps the decision explicit');
  await app.click({ 'data-act': 'task-add-open' }); pullSheet(app, [[0, 180, 100], [20, 180, 200], [40, 180, 320], [60, 180, 400]]); assert.ok(shut(app), 'nothing typed: a pull is the same as Cancel');
  const n = await boot({ role: 'admin', hash: '#calendar', handlers: baseHandlers('admin') });
  await n.click({ 'data-act': 'notice-add-open', 'data-date': TODAY }); assert.equal(n.els['cal-sheet'].getAttribute('data-E-swipe'), 'notice-add-cancel');
  n.input('n-title', 'Pipe repair'); pullSheet(n, [[0, 180, 100], [20, 180, 200], [40, 180, 320], [60, 180, 400]]); assert.ok(!shut(n), 'a notice being typed is kept');
});

test('E_ G2 (s82): the whole header is the pull surface; a finger on the body is the body\'s to scroll (the browser would cancel a pull there); reduced motion still follows and closes', async () => {
  const app = await openDay('admin'); const sh = app.els['cal-sheet'];
  pullSheet(app, [[0, 180, 300], [20, 180, 340], [40, 180, 380], [60, 180, 420]], { grab: false }); assert.ok(!shut(app), 'a pull that starts on the body does nothing, whatever its scroll position');
  sh.scrollTop = 120; pullSheet(app, [[0, 180, 300], [20, 180, 340], [40, 180, 380], [60, 180, 420]], { grab: true }); assert.ok(shut(app), 'the header always works, scrolled or not');
  const r = await openDay('admin', { reduced: true }); const rs = pullSheet(r, [[0, 180, 300], [30, 180, 340], [60, 180, 400], [90, 180, 410]]);
  assert.ok(shut(r), 'still commits'); assert.equal(rs.style.transform, '', 'the pull was handed back to the stylesheet on release (instant under reduced motion)');
  const src = read('styles.css');
  assert.match(src, /\.F_sheethead \{ position: sticky; top: 0; z-index: 4; [^}]*min-height: 56px;[^}]*\}/); assert.match(src, /@media \(max-width: 37\.4375rem\) \{ \.F_sheethead \{ touch-action: none; \} \}/, 'the header the browser must not pan from, on a bottom sheet');
  assert.match(src, /\.E_grab \{ position: sticky; top: 0; z-index: 3; height: 28px;[^}]*touch-action: none; \}/);
  assert.match(src, /\.sheet\.calsheet::before \{ margin: 8px auto 4px; width: 36px; height: 4px; background: var\(--v5-line-2\); \}/, 'the handle is 36 x 4');
  assert.match(read('app.js'), /closest\('\.E_grab, \.F_sheethead'\)/); assert.doesNotMatch(read('app.js'), /!el\.scrollTop/);
});

// ---------------------------------------------------------------------------------------------------- G4 slide
test('E_ G4: the slide commits at 70% of the travel, or a flick after 40%; the knob comes back over 200 ms; edge at 70%, tap on commit', async () => {
  const mk = () => { const knob = { style: {} }; const a = surf({ offsetWidth: 300, querySelector: (q) => (q === '.knob' ? knob : null), getAttribute: (k) => (k === 'href' ? '#door/checklist' : null), href: '#door/checklist' }); return { a, knob }; };
  const run = async (pts) => { const v = vib(), s = mk(), app = await boot({ role: 'cleaner', hash: '#home', nav: v, handlers: baseHandlers('cleaner') }); drive(app, s.a, pts, { sel: '[data-slide]' }); return { v, s, app }; };
  const travel = 244; // 300 - 56
  let r = await run([[0, 40, 10], [100, 40 + travel * 0.5, 12], [200, 40 + travel * 0.7 + 1, 12], [900, 40 + travel * 0.7 + 1, 12]]);
  assert.equal(r.app.location.hash, '#door/checklist'); assert.deepEqual(r.v.calls, [[6], [10]], 'edge at 70%, tap on commit'); assert.equal(r.s.knob.style.transition, 'transform 200ms ease-out, opacity 200ms ease-out'); assert.equal(r.s.knob.style.transform, '');
  r = await run([[0, 40, 10], [400, 40 + travel * 0.6, 12], [800, 40 + travel * 0.69, 12], [1200, 40 + travel * 0.69, 12]]); assert.equal(r.app.location.hash, '#home', 'slow and short of 70%: nothing happens'); assert.equal(r.s.knob.style.transform, '', 'and the knob springs back');
  assert.deepEqual(r.v.calls, [], 'no buzz');
  r = await run([[0, 40, 10], [20, 40 + travel * 0.3, 12], [60, 40 + travel * 0.5, 12], [70, 40 + travel * 0.5, 12]]); assert.equal(r.app.location.hash, '#door/checklist', 'fast after 40%: commits (velocity 0.6 px/ms)');
  r = await run([[0, 40, 10], [10, 40 + travel * 0.3, 12], [20, 40 + travel * 0.39, 12], [30, 40 + travel * 0.39, 12]]); assert.equal(r.app.location.hash, '#home', 'fast but under 40%: no');
  r = await run([[0, 10, 10], [100, 150, 12], [200, 290, 12], [300, 290, 12]]); assert.equal(r.app.location.hash, '#home', 'started in the left edge zone: ignored');
});

const FOLD = { schema: 1, surfaces: { admin: { files: 84 }, checklist: { files: 8 }, manual: { files: 16 }, guide: { files: 48, adminGuide: true } } };
const turnover = () => HOMEWITH([stayRow('Ana Reyes', '2026-10-12', TODAY), stayRow('Ben Cruz', TODAY, '2026-10-18')]);
const showDone = async (app) => { await app.click({ 'data-act': 'tasks-toggle-done' }); };
test('E_ G4: in reduced motion the knob still follows the finger, the release is instant, and the slide still commits; the whole pill stays a link (the tap twin)', async () => {
  const writes = [], knob = { style: new Proxy({}, { set(t, k, v) { if (k === 'transform' && v) writes.push(v); t[k] = v; return true; } }) }, a = surf({ offsetWidth: 300, querySelector: () => knob, getAttribute: (k) => (k === 'href' ? '#door/checklist' : null) });
  const app = await boot({ role: 'cleaner', hash: '#home', reduced: true, fold: FOLD, handlers: baseHandlers('cleaner', { staff_home_v1: turnover }) });
  drive(app, a, [[0, 40, 10], [100, 120, 12], [200, 260, 12], [300, 260, 12]], { sel: '[data-slide]' });
  assert.equal(app.location.hash, '#door/checklist'); assert.ok(writes.length >= 1, 'the knob followed the finger'); assert.equal(knob.style.transform, ''); assert.equal(knob.style.transition, 'none', 'and came back instantly');
  assert.match(app.els['v-home'].innerHTML, /<a class="A_slide" data-slide href="#door\/checklist"[^>]*aria-label="Start cleaning">/);
});

// ---------------------------------------------------------------------------------------------------- G1 the month grid (s82)
async function calApp(hash, o) { return boot(Object.assign({ role: 'admin', hash, handlers: baseHandlers('admin', { staff_home_v1: () => HOMEWITH([stayRow('Ana Reyes', '2026-10-14', '2026-10-17')]) }) }, o || {})); }
const swipeCal = (app, pts, o) => { const cal = surf({ offsetWidth: 328 }); drive(app, cal, pts, Object.assign({ pick: (s) => (s === '.cal' ? cal : null) }, o || {})); return cal; };
const monthOf = (app) => (/<h2 class="dlg"[^>]*>([^<]+)<\/h2>/.exec(app.els['v-calendar'].innerHTML) || [])[1];

test('E_ G1 (s82): swiping the month grid left shows the next month, right the previous one; min(20% of the width, 64 px) or a 32 px flick at 0.3 px/ms', async () => {
  const a = await calApp('#calendar'); assert.equal(monthOf(a), 'October 2026');
  swipeCal(a, [[0, 300, 300], [100, 250, 304], [200, 220, 306], [600, 220, 306]]); assert.equal(monthOf(a), 'November 2026', 'left: 80 px');
  swipeCal(a, [[0, 100, 300], [100, 150, 304], [200, 190, 306], [600, 190, 306]]); assert.equal(monthOf(a), 'October 2026', 'right: back to October (90 px)');
  const slow = await calApp('#calendar'); swipeCal(slow, [[0, 300, 300], [300, 280, 302], [900, 250, 302], [1200, 250, 302]]); assert.equal(monthOf(slow), 'October 2026', '50 px, slow: no');
  const flick = await calApp('#calendar'); swipeCal(flick, [[0, 300, 300], [30, 285, 302], [60, 255, 302], [70, 255, 302]]); assert.equal(monthOf(flick), 'November 2026', '45 px at over 0.3 px/ms');
  const pause = await calApp('#calendar'); swipeCal(pause, [[0, 300, 300], [40, 270, 303], [80, 250, 305], [400, 250, 305]]); assert.equal(monthOf(pause), 'November 2026', '50 px swiped fast and held 320 ms before lifting still counts');
  const arc = await calApp('#calendar'); swipeCal(arc, [[0, 300, 300], [60, 270, 322], [120, 230, 346], [180, 230, 346]]); assert.equal(monthOf(arc), 'November 2026', 'a natural diagonal thumb arc (70 px across, 46 down) is a swipe');
  const edge = await calApp('#calendar'); swipeCal(edge, [[0, 345, 300], [100, 290, 302], [200, 220, 302], [260, 220, 302]]); assert.equal(monthOf(edge), 'October 2026', 'starts at x = 345 of 360: the system Back gesture\'s');
  const vert = await calApp('#calendar'); swipeCal(vert, [[0, 300, 300], [100, 292, 360], [200, 285, 440], [260, 285, 500]]); assert.equal(monthOf(vert), 'October 2026', 'a vertical scroll');
  const stop = await calApp('#calendar'); for (let i = 0; i < 3; i++) swipeCal(stop, [[0, 300, 300], [100, 250, 304], [200, 200, 306], [600, 200, 306]]); assert.equal(monthOf(stop), 'December 2026', 'the calendar offers 60 days ahead and no more');
  const back = await calApp('#calendar'); swipeCal(back, [[0, 100, 300], [100, 160, 304], [200, 260, 306], [600, 260, 306]]); assert.equal(monthOf(back), 'September 2026', '3.1.1: the calendar goes back, so a swipe right shows the month before');
});

test('E_ G1 (s82): the month follows the finger at 0.6x (cap 96 px), a month that is not there does not follow, and the release snaps back over 160 ms', async () => {
  const a = await calApp('#calendar'); const cal = surf({ offsetWidth: 328 }), fire = (t, ev) => (a.listeners[t] || []).forEach((f) => f(ev));
  fire('pointerdown', { target: { closest: (s) => (s === '.cal' ? cal : null) }, clientX: 300, clientY: 300, pointerId: 1, timeStamp: 0, button: 0 });
  fire('pointermove', { clientX: 200, clientY: 301, pointerId: 1, timeStamp: 100 }); assert.equal(cal.style.transform, 'translateX(-60px)'); assert.equal(cal.style.transition, 'none');
  fire('pointermove', { clientX: 30, clientY: 301, pointerId: 1, timeStamp: 200 }); assert.equal(cal.style.transform, 'translateX(-96px)');
  fire('pointerup', { clientX: 30, clientY: 301, pointerId: 1, timeStamp: 210 }); assert.equal(cal.style.transition, 'transform 160ms ease-out, opacity 160ms ease-out'); assert.equal(monthOf(a), 'November 2026');
  const none = await calApp('#calendar'); const c2 = surf({ offsetWidth: 328 }), f2 = (t, ev) => (none.listeners[t] || []).forEach((f) => f(ev));
  f2('pointerdown', { target: { closest: (s) => (s === '.cal' ? c2 : null) }, clientX: 100, clientY: 300, pointerId: 1, timeStamp: 0, button: 0 });
  f2('pointermove', { clientX: 200, clientY: 301, pointerId: 1, timeStamp: 100 }); assert.equal(c2.style.transform, 'translateX(60px)', '3.1.1: right of October is September: it is offered, so the grid follows');
  f2('pointerup', { clientX: 200, clientY: 301, pointerId: 1, timeStamp: 110 });
});

test('E_ G1 (s82): a cancel (the browser took the pan) resets the grid and changes nothing; the sub-tabs are tap only and the arrow keys move between the two', async () => {
  const a = await calApp('#calendar'); const cal = surf({ offsetWidth: 328 }), fire = (t, ev) => (a.listeners[t] || []).forEach((f) => f(ev));
  fire('pointerdown', { target: { closest: (s) => (s === '.cal' ? cal : null) }, clientX: 300, clientY: 300, pointerId: 1, timeStamp: 0, button: 0 });
  fire('pointermove', { clientX: 200, clientY: 301, pointerId: 1, timeStamp: 100 }); fire('pointercancel', { pointerId: 1 });
  assert.equal(cal.style.transform, ''); assert.equal(monthOf(a), 'October 2026');
  const html = a.els['v-calendar'].innerHTML;
  for (const t of ['calendar', 'notices']) assert.match(html, new RegExp('<a href="#calendar[^"]*" data-act="cal-tab" data-tab="' + t + '"'));
  assert.equal((html.match(/data-act="cal-tab"/g) || []).length, 2); assert.doesNotMatch(html, /data-E-swipe="cal-tab"/, 'no swipe on the segmented control');
  const key = (tab, k) => { let stopped = 0; const link = { getAttribute: (n) => (n === 'data-tab' ? tab : null) }; (a.listeners.keydown || []).forEach((f) => f({ key: k, target: { closest: (s) => (/A_tabs a/.test(s) ? link : null) }, preventDefault() { stopped++; } })); return stopped; };
  assert.equal(key('calendar', 'ArrowLeft'), 0); assert.equal(a.location.hash, '#calendar', 'nothing left of Calendar');
  assert.equal(key('calendar', 'ArrowRight'), 1); assert.equal(a.location.hash, '#calendar/notices');
  key('notices', 'ArrowRight'); assert.equal(a.location.hash, '#calendar/notices'); key('notices', 'ArrowLeft'); assert.equal(a.location.hash, '#calendar'); key('calendar', 'Enter'); assert.equal(a.location.hash, '#calendar');
});

test('E_ G1 (s82): the month arrows are the tap twin of the swipe (same result), and the grid names its swipe', async () => {
  const sw = await calApp('#calendar'); swipeCal(sw, [[0, 300, 300], [100, 250, 304], [200, 200, 306], [600, 200, 306]]);
  const tap = await calApp('#calendar'); await tap.click({ 'data-act': 'next' }); assert.equal(monthOf(tap), monthOf(sw)); await tap.click({ 'data-act': 'prev' }); assert.equal(monthOf(tap), 'October 2026');
  assert.match(tap.els['v-calendar'].innerHTML, /Swipe for the next month/); assert.match(tap.els['v-calendar'].innerHTML, /class="cal"[^>]*data-E-swipe="month"|data-E-swipe="month"[^>]*class="cal"|class="cal" role="group"/);
});

// ---------------------------------------------------------------------------------------------------- G3 task row
async function taskApp(list, o) {
  const gone = new Set();
  const app = await boot(Object.assign({ role: 'admin', hash: '#tasks', handlers: baseHandlers('admin', {
    tasks_list_v1: () => tasksOf(list.filter((t) => !gone.has(t.id)), true)(), task_set_done_v1: (a) => { if (a.p_done) gone.add(a.p_id); else gone.delete(a.p_id); return { error: null, data: { ok: true } }; },
    ack_verifier_finding_v1: () => ({ error: null, data: { ok: true } }) }) }, o || {}));
  return app;
}
const rowEl = (key, act, ver, w) => { const cls = new Set(), wrap = { classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c) }, style: {}, cls }; return surf({ style: {}, parentNode: wrap, wrap, getAttribute: (k) => ({ 'data-task': key, 'data-E-swipe': act, 'data-E-verifier': ver ? '1' : '', 'data-E-w': String(w || 96) })[k] ?? null }); };
const swipeTask = (app, row, pts) => drive(app, row, pts, { sel: '.taskrow[data-E-swipe]' });

test('E_ G3: swiping a row left min(33% of the row, 110 px) marks it done through the same call as the box, with an edge buzz at the line and a tap buzz on commit', async () => {
  const v = vib(), app = await taskApp([T({})], { nav: v });
  swipeTask(app, rowEl('follow_up_tasks:a', 'task-done'), [[0, 330, 200], [60, 280, 201], [120, 210, 201], [500, 210, 201]]);
  await app.flush();
  assert.deepEqual(app.calls.filter((c) => c[0] === 'task_set_done_v1').map((c) => c[1]), [{ p_property_id: 'prop-1', p_source: 'follow_up_tasks', p_id: 'a', p_done: true }]);
  const viaBox = await taskApp([T({})]); await viaBox.click({ 'data-act': 'task-done', 'data-task': 'follow_up_tasks:a' });
  assert.deepEqual(viaBox.calls.filter((c) => c[0] === 'task_set_done_v1').map((c) => c[1]), app.calls.filter((c) => c[0] === 'task_set_done_v1').map((c) => c[1]), 'the swipe and the tap send the identical call');
  assert.deepEqual(v.calls, [[6], [10]], 'edge at 110 px, then one tap buzz for the confirm (not two)'); assert.match(app.els['cs-toast'].innerHTML, /Marked done/);
});

test('E_ G3: a short swipe past 48 px leaves the row open on a real Done button; a swipe under 48 px or to the right closes it; a 40 px flick at 0.35 px/ms commits', async () => {
  const app = await taskApp([T({})]), row = rowEl('follow_up_tasks:a', 'task-done');
  swipeTask(app, row, [[0, 330, 200], [200, 300, 201], [400, 270, 201], [800, 270, 201]]);
  assert.ok(row.wrap.cls.has('E_open'), 'open at 60 px'); assert.equal(app.calls.filter((c) => c[0] === 'task_set_done_v1').length, 0, 'nothing sent: the person taps Done');
  const small = rowEl('follow_up_tasks:a', 'task-done'); swipeTask(app, small, [[0, 330, 200], [200, 310, 201], [400, 290, 201], [800, 290, 201]]); assert.ok(!small.wrap.cls.has('E_open'), '40 px: closes');
  const right = rowEl('follow_up_tasks:a', 'task-done'); swipeTask(app, right, [[0, 100, 200], [200, 160, 201], [400, 250, 201], [800, 250, 201]]); assert.ok(!right.wrap.cls.has('E_open'), 'to the right: nothing');
  const flick = rowEl('follow_up_tasks:a', 'task-done'); swipeTask(app, flick, [[0, 330, 200], [30, 310, 201], [60, 285, 201], [70, 285, 201]]); await app.flush();
  assert.equal(app.calls.filter((c) => c[0] === 'task_set_done_v1').length, 1, 'a 45 px flick at 0.75 px/ms commits (it needed 60 at 0.5 before)');
});

test('E_ G3: a finished row swipes to Undo; the markup carries an Undo underlay; a system check row only opens "Mark as handled" and never auto-commits', async () => {
  const done = T({ id: 'd', status: 'done', title: 'Finished job' }), ver = T({ source: 'verifier_findings', id: 'V10:abc', kind: 'verifier', title: 'A check needs a look' });
  const app = await taskApp([done, ver]); await showDone(app);
  const h = app.els['v-tasks'].innerHTML;
  assert.match(h, /data-E-swipe="task-undo"[^>]*data-task="follow_up_tasks:d"/); assert.match(h, /<button class="E_underbtn" type="button" data-act="task-undo" data-task="follow_up_tasks:d" aria-label="Undo: Finished job"/);
  assert.match(h, /data-E-verifier="1" data-E-w="148"/); assert.match(h, /data-act="task-done" data-task="verifier_findings:V10:abc" aria-label="Mark as handled: A check needs a look">[^<]*<svg[^>]*><\/svg>Mark as handled<\/button>/);
  const v = rowEl('verifier_findings:V10:abc', 'task-done', true, 148); swipeTask(app, v, [[0, 330, 200], [60, 250, 201], [120, 60, 201], [500, 60, 201]]); await app.flush();
  assert.equal(app.calls.filter((c) => c[0] === 'ack_verifier_finding_v1').length, 0, 'a swipe never acknowledges a system check'); assert.equal(app.calls.filter((c) => c[0] === 'task_set_done_v1').length, 0);
  assert.ok(v.wrap.cls.has('E_open'), 'it opens its button instead');
  const u = await taskApp([T({ id: 'd', status: 'done' })]), ur = rowEl('follow_up_tasks:d', 'task-undo');
  swipeTask(u, ur, [[0, 330, 200], [60, 280, 201], [120, 150, 201], [500, 150, 201]]); await u.flush();
  assert.deepEqual(u.calls.filter((c) => c[0] === 'task_set_done_v1').map((c) => c[1].p_done), [false], 'the same path as the Undo box: back on the list');
});

test('E_ G3: the underlay is hidden from touch and keyboard until the row moves, and a touch elsewhere closes an open row', () => {
  const css = read('styles.css');
  assert.match(css, /\.E_under \{[^}]*visibility: hidden; \}/); assert.match(css, /\.E_swipewrap\.E_live \.E_under, \.E_swipewrap\.E_open \.E_under \{ visibility: visible; \}/);
  assert.match(css, /\.E_swipewrap \.payrow \{[^}]*touch-action: pan-y pinch-zoom;/); assert.match(css, /\.E_done \.E_underbtn \{ background: var\(--v5-ok-w\); color: var\(--v5-ok-t\); \}/); assert.match(css, /\.E_undo \.E_underbtn \{ background: var\(--v5-info-w\); color: var\(--v5-info-t\); \}/);
  assert.match(css, /\.E_underbtn \{ flex: 1; min-height: var\(--touch\);[^}]*font: 600 var\(--v5-t-body\)\/clamp\(1\.375rem/);
  assert.match(read('app.js'), /a touch anywhere else closes an open row/);
});

// ---------------------------------------------------------------------------------------------------- the guard
test('E_ tap-twin guard: every element that carries data-E-swipe has a visible way to do the same thing; no gesture is ever the only way', async () => {
  // tasks: the row holds the box with the same data-act, and the wrapper holds the underlay button with it too
  const app = await taskApp([T({}), T({ id: 'd', status: 'done' }), T({ source: 'verifier_findings', id: 'V1:x', kind: 'verifier', title: 'Check' })]); await showDone(app);
  const h = app.els['v-tasks'].innerHTML; let seen = 0;
  for (const m of h.matchAll(/<div class="E_swipewrap"[^>]*>(.*?)<\/div><\/div><\/div>/gs)) {
    const w = m[1], act = (/data-E-swipe="([^"]+)"/.exec(w) || [])[1]; seen++;
    assert.ok(act, 'a row names its action'); assert.ok(w.includes('<button class="chk" type="button" role="checkbox"') && w.includes('data-act="' + act + '"'), 'the box does the same');
    assert.match(w, new RegExp('<button class="E_underbtn" type="button" data-act="' + act + '"'));
  }
  assert.ok(seen >= 2, 'the guard looked at rows: ' + seen);
  // calendar: the body names cal-tab and the three tab links carry that act
  const cal = (await calApp('#calendar')).els['v-calendar'].innerHTML; assert.match(cal, /class="cal" role="group" data-E-swipe="month"/); assert.equal((cal.match(/data-act="prev"/g) || []).length, 1); assert.equal((cal.match(/data-act="next"/g) || []).length, 1, 'the arrows are the twin'); assert.equal((cal.match(/data-act="cal-tab"/g) || []).length, 2);
  // sheets: the sheet names the act of its own Close / Cancel / Go back button, and the body draws that button
  const checks = [];
  const day = await openDay('admin'); checks.push(day);
  const add = await boot({ role: 'admin', hash: '#tasks', handlers: baseHandlers('admin', { tasks_list_v1: tasksOf([], true) }) }); await add.click({ 'data-act': 'task-add-open' }); checks.push(add);
  const nadd = await calApp('#calendar'); await nadd.click({ 'data-act': 'notice-add-open', 'data-date': TODAY }); checks.push(nadd);
  const news = await boot({ role: 'cleaner', hash: '#more', handlers: baseHandlers('cleaner') }); await news.click({ 'data-act': 'whatsnew' }); checks.push(news);
  const attn = await boot({ role: 'cleaner', hash: '#home', handlers: baseHandlers('cleaner') }); await attn.click({ 'data-act': 'attn-open' }); checks.push(attn);
  const warn = await boot({ role: 'admin', hash: '#calendar/stays', handlers: baseHandlers('admin', { staff_home_v1: () => HOMEWITH([], { warnings: [{ kind: 'inventory', title: 'Low stock: soap', detail: {} }] }) }) });
  await warn.click({ 'data-warn': 'inventory|Low stock: soap|' }); checks.push(warn);
  for (const x of checks) { const act = x.els['cal-sheet'].getAttribute('data-E-swipe'); assert.ok(act, 'the sheet names its twin'); assert.ok(x.els['cs-body'].innerHTML.includes('data-act="' + act + '"'), 'the body draws the button for ' + act); }
  // the slide is itself the link
  const home = await boot({ role: 'cleaner', hash: '#home', fold: FOLD, handlers: baseHandlers('cleaner', { staff_home_v1: turnover }) }); assert.match(home.els['v-home'].innerHTML, /<a class="A_slide" data-slide href="#door\/checklist"/);
});

test('E_ the rejected gestures are not built: no main-tab swipe, snooze, pull to refresh, notice dismiss, long press, sub-tab swipe, or touch-event listener', () => {
  const src = read('app.js');
  assert.equal((src.match(/E_drag\(document, \{ sel:/g) || []).length, 5, 'the slide, the sheet pull, the task row, the month grid and the day sheet: all through the one helper');
  assert.match(src, /sel: '\.cal', axis: 'x'/); assert.doesNotMatch(src, /sel: '\.E_tabbody'/, 'the sub-tab swipe (old G1) is removed: the segmented control is tap only');
  assert.doesNotMatch(src, /touchstart|touchmove|touchend|contextmenu', function \(ev\) \{ var .*press|longpress|long-press|snooze|pull.to.refresh|ptr/i);
  assert.doesNotMatch(src, /sel: '\.cal \.d'|sel: '\.A_nlist|sel: '\.C_notice|sel: '\.tabbar|sel: '#app'|sel: '\.view/, 'no swipe between the main tabs');
});
