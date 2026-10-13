// Lane E: the haptic vocabulary. CS.E_buzz is a silent no-op where navigator.vibrate is missing, when switched off, and when the page is hidden.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CS, read, boot, HOMEWITH, baseHandlers, TODAY } from './_a_harness.mjs';

const T = (o) => Object.assign({ source: 'follow_up_tasks', id: 'a', kind: 'reminder', title: 'Water the plants', priority: 'normal', status: 'open', due_at: '2026-10-12T09:00:00Z', mine: true, blocks_arrival: false, detail: null, assignee_label: null, created_at: '2026-10-01T00:00:00Z' }, o);
const vib = () => { const calls = []; return { calls, vibrate: (p) => { calls.push(p); return true; } }; };
const store = (init) => { const m = Object.assign({}, init || {}), log = []; return { m, log, getItem: (k) => { log.push(['get', k]); return k in m ? m[k] : null; }, setItem: (k, v) => { log.push(['set', k, v]); m[k] = String(v); }, removeItem() {} }; };
const reset = () => CS.E_hapticsSet(true);

test('E_buzz: the three words are exactly [10], [30, 60, 30] and [6]; an unknown word buzzes nothing', () => {
  reset(); const v = vib(), env = { navigator: v, storage: store(), doc: { visibilityState: 'visible' } };
  assert.equal(CS.E_buzz('tap', env), true); assert.equal(CS.E_buzz('error', env), true); assert.equal(CS.E_buzz('edge', env), true);
  assert.deepEqual(v.calls, [[10], [30, 60, 30], [6]]); assert.deepEqual(CS.E_PATTERNS, { tap: [10], error: [30, 60, 30], edge: [6] });
  assert.equal(CS.E_buzz('nudge', env), false); assert.equal(CS.E_buzz('toString', env), false); assert.equal(v.calls.length, 3);
  v.calls[0].push(99); assert.deepEqual(CS.E_PATTERNS.tap, [10], 'the shared pattern is never handed out to be changed');
});

test('E_buzz: without navigator.vibrate (iPhone Safari, desktop) every call is a silent no-op that throws nothing', () => {
  reset();
  for (const nav of [undefined, null, {}, { userAgent: 'iPhone' }, { vibrate: undefined }, { vibrate: 'yes' }]) for (const k of ['tap', 'error', 'edge']) assert.equal(CS.E_buzz(k, { navigator: nav, storage: store(), doc: { visibilityState: 'visible' } }), false);
  assert.equal(CS.E_buzz('tap'), false); assert.equal(CS.E_buzz('tap', {}), false);
  assert.equal(CS.E_buzz('tap', { navigator: { vibrate() { throw new Error('blocked'); } } }), false, 'a vibrate that throws is swallowed');
});

test('E_buzz: off when the setting says 0, when the person switched it off this page load, and when the page is hidden; blocked storage means on', () => {
  reset(); const v = vib();
  assert.equal(CS.E_buzz('tap', { navigator: v, storage: store({ cs_haptics: '0' }) }), false);
  assert.equal(CS.E_buzz('tap', { navigator: v, storage: store({ cs_haptics: '1' }) }), true);
  assert.equal(CS.E_buzz('tap', { navigator: v, storage: { getItem() { throw new Error('denied'); } } }), true, 'blocked storage never silences a buzz');
  assert.equal(CS.E_buzz('tap', { navigator: v, storage: store(), doc: { visibilityState: 'hidden' } }), false);
  const s = store(); CS.E_hapticsSet(false, s); assert.deepEqual(s.m, { cs_haptics: '0' }); assert.equal(CS.E_buzz('tap', { navigator: v, storage: s }), false); assert.equal(CS.E_hapticsOn(s), false);
  CS.E_hapticsSet(true, s); assert.deepEqual(s.m, { cs_haptics: '1' }); assert.equal(CS.E_hapticsOn(s), true);
  CS.E_hapticsSet(false); assert.equal(CS.E_hapticsOn(null), false, 'no storage (demo): the choice lives in memory');
  assert.equal(v.calls.length, 2); reset();
});

test('E_buzz: reduced motion and Save-Data do not turn haptics off (a buzz is not motion), and edge is the only word a drag may use', () => {
  reset(); const v = vib();
  assert.equal(CS.E_buzz('tap', { navigator: Object.assign(v, { connection: { saveData: true } }), storage: store(), doc: { visibilityState: 'visible' } }), true);
  const src = read('app.js'); assert.doesNotMatch(src, /saveData/); assert.match(src, /function buzz\(kind\) \{ return CS\.E_buzz\(kind, \{ navigator: navigator, storage: store\('localStorage'\), doc: document \}\); \}/);
  const body = (re) => [...src.matchAll(re)].length;
  assert.equal(body(/buzz\('edge'\)/g), 3, 'slide, sheet and task row: one edge buzz each (fired once per drag by E_drag)');
});

test('E_ haptics in the app: marking a task done buzzes once ([10]); a refused save buzzes the error pattern; with the switch off nothing buzzes', async () => {
  reset(); const v = vib(), ls = store();
  const ok = await boot({ role: 'admin', hash: '#tasks', nav: v, ls, handlers: baseHandlers('admin', { tasks_list_v1: () => ({ error: null, data: { ok: true, manager: true, today: TODAY, tasks: [T({})] } }), task_set_done_v1: () => ({ error: null, data: { ok: true } }) }) });
  await ok.click({ 'data-act': 'task-done', 'data-task': 'follow_up_tasks:a' });
  assert.deepEqual(v.calls, [[10]], 'one buzz for one confirm');
  const bad = vib();
  const fail = await boot({ role: 'admin', hash: '#tasks', nav: bad, ls: store(), handlers: baseHandlers('admin', { tasks_list_v1: () => ({ error: null, data: { ok: true, manager: true, today: TODAY, tasks: [T({})] } }), task_set_done_v1: () => ({ error: { code: '500', message: 'x' }, data: null }) }) });
  await fail.click({ 'data-act': 'task-done', 'data-task': 'follow_up_tasks:a' });
  assert.deepEqual(bad.calls, [[10], [30, 60, 30]], 'the tap, then the failure');
  const off = vib(), offLs = store({ cs_haptics: '0' });
  const quiet = await boot({ role: 'admin', hash: '#tasks', nav: off, ls: offLs, handlers: baseHandlers('admin', { tasks_list_v1: () => ({ error: null, data: { ok: true, manager: true, today: TODAY, tasks: [T({})] } }), task_set_done_v1: () => ({ error: null, data: { ok: true } }) }) });
  await quiet.click({ 'data-act': 'task-done', 'data-task': 'follow_up_tasks:a' }); assert.deepEqual(off.calls, []);
  const hidden = vib();
  const bg = await boot({ role: 'admin', hash: '#tasks', nav: hidden, ls: store(), visible: false, handlers: baseHandlers('admin', { tasks_list_v1: () => ({ error: null, data: { ok: true, manager: true, today: TODAY, tasks: [T({})] } }), task_set_done_v1: () => ({ error: null, data: { ok: true } }) }) });
  await bg.click({ 'data-act': 'task-done', 'data-task': 'follow_up_tasks:a' }); assert.deepEqual(hidden.calls, [], 'a hidden page never buzzes');
  reset();
});

test('E_ haptics setting: "Vibrate on confirm" is on More > Appearance only where vibration exists; the switch writes cs_haptics and stops the buzz', async () => {
  reset(); const none = await boot({ role: 'cleaner', hash: '#more', handlers: baseHandlers('cleaner') });
  assert.doesNotMatch(none.els['v-more'].innerHTML, /Vibrate on confirm|data-act="haptics"/, 'no vibrate in this browser: no switch at all');
  const v = vib(), ls = store();
  const app = await boot({ role: 'cleaner', hash: '#more', nav: v, ls, handlers: baseHandlers('cleaner') });
  let h = app.els['v-more'].innerHTML;
  assert.match(h, /<b>Vibrate on confirm<\/b>/); assert.match(h, /data-act="haptics" aria-checked="true"/); assert.match(h, /A short buzz when something is saved or finished\. Off saves nothing but the buzz\./);
  assert.ok(h.indexOf('Plain bars') < h.indexOf('Vibrate on confirm') && h.indexOf('Vibrate on confirm') < h.indexOf('aria-label="Cassy"'), 'under Plain bars, inside Appearance');
  await app.click({ 'data-act': 'haptics' });
  assert.deepEqual(ls.m, { cs_haptics: '0' }); assert.match(app.els['v-more'].innerHTML, /data-act="haptics" aria-checked="false"/);
  await app.click({ 'data-act': 'haptics' }); assert.deepEqual(ls.m, { cs_haptics: '1' }); assert.match(app.els['v-more'].innerHTML, /data-act="haptics" aria-checked="true"/);
  reset();
});

test('E_ haptics in demo: the choice is kept in memory only, nothing is written to storage and no network call is made', async () => {
  reset(); const v = vib(), ls = store(), fetched = [];
  const app = await boot({ role: 'cleaner', hash: '#more', demo: true, nav: v, ls, handlers: baseHandlers('cleaner') });
  await app.click({ 'data-act': 'haptics' });
  assert.match(app.els['v-more'].innerHTML, /data-act="haptics" aria-checked="false"/); assert.equal(CS.E_hapticsOn(null), false);
  assert.deepEqual(ls.log, [], 'not one read or write of storage'); assert.deepEqual(fetched, []);
  reset();
});
