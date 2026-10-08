import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const require = createRequire(import.meta.url);
const CS = require('../lib.js');
const P = require('../pay/pay-lib.js');

// D-301: the Tasks tab (one list) and the Pay rates screen. Pure helpers first, then app.js run against a stub DOM and a fake
// Supabase so the real screens, taps and RPC calls are exercised.

const TODAY = '2026-10-06';
const task = (o) => ({ source: 'follow_up_tasks', id: 'f1', kind: 'reminder', title: 'T', detail: null, priority: 'normal', status: 'open', due_at: null, assignee_id: null, assignee_label: null, mine: false, created_at: '2026-10-01T00:00:00Z', completed_at: null, version: 1, blocks_arrival: false, ...o });

test('task due state uses the Manila day: 23:30 UTC on the 5th is already the 6th', () => {
  assert.equal(CS.manilaDayOf('2026-10-05T23:30:00Z'), '2026-10-06');
  assert.equal(CS.manilaDayOf('2026-10-06T16:00:00Z'), '2026-10-07');
  assert.equal(CS.manilaDayOf(null), null);
  assert.equal(CS.manilaDayOf('garbage'), null);
  assert.equal(CS.taskDue('2026-10-05T10:00:00Z', TODAY), 'overdue');
  assert.equal(CS.taskDue('2026-10-06T02:00:00Z', TODAY), 'today');
  assert.equal(CS.taskDue('2026-10-09T02:00:00Z', TODAY), 'later');
  assert.equal(CS.taskDue(null, TODAY), 'none');
  assert.equal(CS.taskDue('garbage', TODAY), 'none');
});

test('task due wording: overdue says was due, a midnight due time shows no clock, tomorrow is named', () => {
  assert.equal(CS.taskDueLabel('2026-10-04T16:00:00Z', TODAY), 'Was due 5 Oct'); // 00:00 on the 5th in Manila
  assert.equal(CS.taskDueLabel('2026-10-06T07:00:00Z', TODAY), 'Due today 3:00 PM');
  assert.equal(CS.taskDueLabel('2026-10-06T16:00:00Z', TODAY), 'Due tomorrow');
  assert.equal(CS.taskDueLabel('2026-10-09T02:00:00Z', TODAY), 'Due 9 Oct 10:00 AM');
  assert.equal(CS.taskDueLabel(null, TODAY), '');
});

test('a reminder due date becomes 00:00 Manila, and a bad or empty one is null', () => {
  assert.equal(CS.dueFromDate('2026-10-08'), '2026-10-07T16:00:00.000Z');
  assert.equal(CS.dueFromDate(''), null);
  assert.equal(CS.dueFromDate('08/10/2026'), null);
  assert.equal(CS.dueFromDate(null), null);
});

test('taskGroups: overdue, today, coming up, no date, done; a done task is never overdue; urgent first', () => {
  const g = CS.taskGroups([
    task({ id: 'later', due_at: '2026-10-09T02:00:00Z' }), task({ id: 'today', due_at: '2026-10-06T02:00:00Z' }),
    task({ id: 'low', priority: 'low' }), task({ id: 'urgent', priority: 'urgent' }), task({ id: 'late', due_at: '2026-10-01T02:00:00Z' }),
    task({ id: 'done', status: 'done', due_at: '2026-10-01T02:00:00Z' }),
  ], TODAY);
  assert.deepEqual(g.map((x) => x.key), ['overdue', 'today', 'later', 'none', 'done']);
  assert.deepEqual(g.find((x) => x.key === 'overdue').tasks.map((t) => t.id), ['late']);
  assert.deepEqual(g.find((x) => x.key === 'none').tasks.map((t) => t.id), ['urgent', 'low']);
  assert.deepEqual(CS.taskGroups([], TODAY), []);
  assert.deepEqual(CS.taskGroups(null, TODAY), []);
});

test('taskDueCount counts open tasks that are overdue or due today, nothing else', () => {
  assert.equal(CS.taskDueCount([task({ due_at: '2026-10-01T02:00:00Z' }), task({ due_at: '2026-10-06T02:00:00Z' }), task({ due_at: '2026-10-09T02:00:00Z' }), task({}), task({ status: 'done', due_at: '2026-10-01T02:00:00Z' })], TODAY), 2);
  assert.equal(CS.taskDueCount(undefined, TODAY), 0);
});

test('kind labels are plain words; an unknown kind is just "Task"', () => {
  assert.equal(CS.taskKindLabel('cleaning_issue'), 'Cleaning issue');
  assert.equal(CS.taskKindLabel('verifier'), 'Check needs a person');
  assert.equal(CS.taskKindLabel('constructor'), 'Task');
  assert.equal(CS.taskKindLabel(undefined), 'Task');
});

test('a tasks payload passes the no-money belt; a guest amount key does not', () => {
  assert.equal(CS.assertNoMoney([task({})]), true);
  assert.throws(() => CS.assertNoMoney([{ ...task({}), total_amount: 5 }]), /money/);
});

test('rates: only owner and admin edit; unknown stays null; the sentence names the transport rule', () => {
  assert.equal(CS.canEditRates('owner'), true); assert.equal(CS.canEditRates('admin'), true);
  for (const r of ['finance', 'cleaner', 'inspector', 'maintenance', '', null, undefined]) assert.equal(CS.canEditRates(r), false);
  assert.equal(CS.rateNum(null), null); assert.equal(CS.rateNum(''), null); assert.equal(CS.rateNum('abc'), null); assert.equal(CS.rateNum('150.00'), 150); assert.equal(CS.rateNum(0), 0);
  assert.equal(CS.rateLine({ regular_rate: 500, general_rate: 1000, transport_rate: 150 }, P.peso), '₱500 per clean · ₱1,000 per deep clean · ₱150 transport when ticked');
  assert.match(CS.rateLine({ regular_rate: 650, general_rate: 1000, transport_rate: null }, P.peso), /transport included$/);
  assert.match(CS.rateLine({ regular_rate: 500, general_rate: null, transport_rate: null }, P.peso), /₱500 per deep clean/);
  assert.match(CS.rateLine({ regular_rate: null, general_rate: null, transport_rate: null }, P.peso), /^- per clean/);
});

test('earliest start: after the latest row when that starts today or later, else today', () => {
  assert.equal(CS.earliestRateStart([{ effective_from: '2026-09-30' }, { effective_from: '2026-05-07' }], TODAY), TODAY);
  assert.equal(CS.earliestRateStart([{ effective_from: '2026-10-06' }], TODAY), '2026-10-07');
  assert.equal(CS.earliestRateStart([{ effective_from: '2026-10-20' }, { effective_from: '2026-09-30' }], TODAY), '2026-10-21');
  assert.equal(CS.earliestRateStart([], TODAY), TODAY);
});

test('rateProblem mirrors admin_add_pay_rate_v1', () => {
  const ok = { from: '2026-10-10', regular: '500', general: '1,000', transport: '150', note: 'Honey agreed' };
  const e = TODAY;
  assert.equal(CS.rateProblem(ok, e, TODAY), '');
  assert.equal(CS.rateProblem({ ...ok, transport: '' }, e, TODAY), '');
  assert.equal(CS.rateProblem({ ...ok, transport: '0' }, e, TODAY), '');
  assert.match(CS.rateProblem({ ...ok, from: '2026-10-05' }, e, TODAY), /or later/);
  assert.match(CS.rateProblem({ ...ok, from: '2027-12-01' }, e, TODAY), /year/);
  assert.match(CS.rateProblem({ ...ok, from: '' }, e, TODAY), /date/);
  assert.match(CS.rateProblem({ ...ok, regular: '0' }, e, TODAY), /cleaning fee/);
  assert.match(CS.rateProblem({ ...ok, regular: '' }, e, TODAY), /cleaning fee/);
  assert.match(CS.rateProblem({ ...ok, regular: '500.555' }, e, TODAY), /cleaning fee/);
  assert.match(CS.rateProblem({ ...ok, general: '10001' }, e, TODAY), /deep clean/);
  assert.match(CS.rateProblem({ ...ok, transport: '2001' }, e, TODAY), /transport/);
  assert.match(CS.rateProblem({ ...ok, transport: '-1' }, e, TODAY), /transport/);
  assert.match(CS.rateProblem({ ...ok, note: ' ab ' }, e, TODAY), /why/i);
});

test('rateArgs builds the RPC arguments: commas dropped, empty or 0 transport is null', () => {
  assert.deepEqual(CS.rateArgs('p1', { from: '2026-10-10', regular: '500', general: '1,000', transport: '150', note: ' because ' }),
    { p_property_id: 'p1', p_effective_from: '2026-10-10', p_regular: 500, p_general: 1000, p_transport: 150, p_note: 'because' });
  assert.equal(CS.rateArgs('p1', { from: 'x', regular: '1', general: '1', transport: '', note: 'abc' }).p_transport, null);
  assert.equal(CS.rateArgs('p1', { from: 'x', regular: '1', general: '1', transport: '0', note: 'abc' }).p_transport, null);
});

// ------------------------------------------------------------------------------------------------ app.js against a stub DOM
function el() {
  const e = { innerHTML: '', textContent: '', hidden: false, disabled: false, value: '', checked: false, className: '', style: {}, children: [], title: '',
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, setAttribute() {}, getAttribute: () => null, removeAttribute() {}, addEventListener() {},
    querySelectorAll: () => [], querySelector: () => null, focus() {}, scrollIntoView() {}, closest: () => null, appendChild() {}, onclick: null };
  return e;
}
async function boot({ role, hash, handlers, nav }) {
  const els = {}, listeners = {}, calls = [];
  const location = { hash, pathname: '/', search: '', origin: 'https://staff.example', replace() {} };
  const docObj = {
    getElementById: (id) => (els[id] ||= el()), querySelector: () => null, querySelectorAll: () => [], visibilityState: 'visible',
    addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); },
  };
  const sb = {
    auth: { getSession: () => Promise.resolve({ data: { session: { user: { email: 'ana@staff.cascade.invalid', user_metadata: { display_name: 'Ana' } }, access_token: 't' } } }), signOut: () => Promise.resolve({}), },
    rpc: (name, args) => { calls.push([name, JSON.parse(JSON.stringify(args || {}))]); const h = handlers[name]; return Promise.resolve(h ? JSON.parse(JSON.stringify(h(args))) : { error: null, data: null }); },
    storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ error: { message: 'x' } }) }) },
  };
  const win = {
    supabase: { createClient: () => sb }, CS, P, CSPay: P, ICON: (n, c) => `<svg class="i ${c || ''}" data-i="${n}"></svg>`, CSTheme: { get: () => 'auto', set() {} },
    addEventListener() {}, matchMedia: () => ({ matches: false }), scrollTo() {}, scrollY: 0, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  };
  const ctx = { window: win, document: docObj, location, history: { replaceState(a, b, h) { location.hash = h; } }, navigator: { userAgent: 'test', ...(nav || {}) }, localStorage: win.localStorage,
    matchMedia: () => ({ matches: false }), fetch: () => Promise.resolve({ ok: false }), setTimeout, clearTimeout, console, URL, Image: function () {}, Date, Math, JSON, Promise, crypto: { randomUUID: () => 'uuid-fixed-0001' } };
  win.crypto = ctx.crypto;
  vm.createContext(ctx);
  vm.runInContext(read('app.js'), ctx);
  const flush = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r)); };
  await flush();
  const click = async (attrs) => {
    const btn = { getAttribute: (n) => (n in attrs ? attrs[n] : null), hasAttribute: (n) => n in attrs };
    for (const fn of listeners.click || []) fn({ target: { closest: () => btn } });
    await flush();
  };
  const input = (id, value) => { for (const fn of listeners.input || []) fn({ target: { id, value } }); };
  return { els, calls, click, input, flush, location, listeners };
}
const ACCESS = (role) => ({ error: null, data: { role, disabled: false, session_current: true, property_ids: ['prop-1'] } });
const HOME = { error: null, data: { today: TODAY, warnings: [], calendar: [], weather: null, current_guest: null, next_guest: null, generated_at: '2026-10-06T00:00:00Z' } };

const STAFF_TASKS = {
  ok: true, manager: false, today: TODAY, tasks: [
    task({ id: 'f1', title: 'Water plants [hidden] ring [hidden]', mine: true, due_at: '2026-10-01T02:00:00Z' }),
    task({ source: 'work_orders', id: 'w1', kind: 'cleaning_issue', title: 'Leaking tap in the bathroom', priority: 'urgent', blocks_arrival: true }),
  ],
};
const ADMIN_TASKS = {
  ok: true, manager: true, today: TODAY, tasks: [
    task({ id: 'f2', title: 'Check gate latch', assignee_label: 'Dan', assignee_id: 'u-9' }),
    task({ source: 'verifier_findings', id: 'V10:abc', kind: 'verifier', title: 'A check needs a look', priority: 'high' }),
  ],
};

test('staff Tasks tab: the list is drawn, overdue shows, the tab carries the due count, no add button', async () => {
  const app = await boot({ role: 'cleaner', hash: '#tasks', handlers: { current_staff_access: () => ACCESS('cleaner'), staff_home_v1: () => HOME, tasks_list_v1: () => ({ error: null, data: STAFF_TASKS }) } });
  const html = app.els['v-tasks'].innerHTML;
  assert.match(html, /Water plants \[hidden\] ring \[hidden\]/);
  assert.match(html, /Leaking tap in the bathroom/);
  assert.match(html, /Overdue \(1\)/); assert.match(html, /No date \(1\)/);
  assert.match(html, /Was due 1 Oct/); assert.match(html, /Cleaning issue/);
  assert.match(html, /Yours/); assert.match(html, /Blocks arrival/);
  assert.doesNotMatch(html, /Add a reminder/);
  assert.match(html, /What is yours to do/);
  assert.match(app.els.tabbar.innerHTML, /href="#tasks" aria-current="page"/);
  assert.match(app.els.tabbar.innerHTML, /aria-label="1 due"/);
  assert.deepEqual(app.calls.find((c) => c[0] === 'tasks_list_v1')[1], { p_property_id: 'prop-1', p_include_done: false });
});

test('tapping the box finishes a task through task_set_done_v1 and the Undo line reopens it', async () => {
  const finished = new Set(); // the server hides a finished task from the default list, like tasks_list_v1 does
  const app = await boot({ role: 'cleaner', hash: '#tasks', handlers: { current_staff_access: () => ACCESS('cleaner'), staff_home_v1: () => HOME,
    tasks_list_v1: () => ({ error: null, data: { ...STAFF_TASKS, tasks: STAFF_TASKS.tasks.filter((t) => !finished.has(t.id)) } }),
    task_set_done_v1: (a) => { if (a.p_done) finished.add(a.p_id); else finished.delete(a.p_id); return { error: null, data: { ok: true, changed: true } }; } } });
  await app.click({ 'data-act': 'task-done', 'data-task': 'work_orders:w1' });
  assert.deepEqual(app.calls.find((c) => c[0] === 'task_set_done_v1')[1], { p_property_id: 'prop-1', p_source: 'work_orders', p_id: 'w1', p_done: true });
  assert.match(app.els['v-tasks'].innerHTML, /Marked done: Leaking tap/);
  assert.match(app.els['v-tasks'].innerHTML, /data-act="task-undo" data-task="work_orders:w1"/);
  await app.click({ 'data-act': 'task-undo', 'data-task': 'work_orders:w1' });
  const done = app.calls.filter((c) => c[0] === 'task_set_done_v1');
  assert.equal(done.length, 2); assert.equal(done[1][1].p_done, false);
  assert.match(app.els['v-tasks'].innerHTML, /Leaking tap in the bathroom/, 'after the undo the task is back on the list');
});

test('a task the server refuses goes back on the list with a plain sentence', async () => {
  const app = await boot({ role: 'cleaner', hash: '#tasks', handlers: { current_staff_access: () => ACCESS('cleaner'), staff_home_v1: () => HOME, tasks_list_v1: () => ({ error: null, data: STAFF_TASKS }), task_set_done_v1: () => ({ error: { code: 'P0002', message: 'task not found' }, data: null }) } });
  await app.click({ 'data-act': 'task-done', 'data-task': 'work_orders:w1' });
  assert.match(app.els['v-tasks'].innerHTML, /That task is not yours to change/);
  assert.doesNotMatch(app.els['v-tasks'].innerHTML, /Marked done:/);
});

test('admin Tasks tab: everything with who it is for, a check is acknowledged not toggled, a reminder is added with its idempotency key', async () => {
  const app = await boot({ role: 'owner', hash: '#tasks', handlers: {
    current_staff_access: () => ACCESS('owner'), staff_home_v1: () => HOME, tasks_list_v1: () => ({ error: null, data: ADMIN_TASKS }),
    task_assignees_v1: () => ({ error: null, data: { ok: true, staff: [{ user_id: 'u-1', role: 'cleaner', label: 'Honey' }] } }),
    task_add_reminder_v1: () => ({ error: null, data: { ok: true, id: 'n1', replayed: false } }), ack_verifier_finding_v1: () => ({ error: null, data: { ok: true } }) } });
  let html = app.els['v-tasks'].innerHTML;
  assert.match(html, /for Dan/); assert.match(html, /Check needs a person/); assert.match(html, /Add a reminder/); assert.match(html, /Everything that needs a person/);
  await app.click({ 'data-act': 'task-done', 'data-task': 'verifier_findings:V10:abc' });
  assert.deepEqual(app.calls.find((c) => c[0] === 'ack_verifier_finding_v1')[1], { p_key: 'V10:abc' });
  assert.ok(!app.calls.some((c) => c[0] === 'task_set_done_v1'), 'a check never goes through task_set_done_v1');
  await app.click({ 'data-act': 'task-add-open' });
  assert.match(app.els['v-tasks'].innerHTML, /id="t-title"/); assert.match(app.els['v-tasks'].innerHTML, /Honey \(cleaner\)/);
  await app.click({ 'data-act': 'task-add-save' });
  assert.match(app.els['v-tasks'].innerHTML, /short title/); assert.ok(!app.calls.some((c) => c[0] === 'task_add_reminder_v1'), 'an empty title is not sent');
  app.input('t-title', '  Order new towels '); app.input('t-due', '2026-10-08'); app.input('t-who', 'u-1'); app.input('t-note', 'Call first');
  await app.click({ 'data-act': 'task-add-save' });
  assert.deepEqual(app.calls.find((c) => c[0] === 'task_add_reminder_v1')[1], {
    p_property_id: 'prop-1', p_title: 'Order new towels', p_due_at: '2026-10-07T16:00:00.000Z', p_assignee_user_id: 'u-1', p_note: 'Call first', p_idempotency_key: 'rem-uuid-fixed-0001' });
  assert.doesNotMatch(app.els['v-tasks'].innerHTML, /id="t-title"/, 'the form closes after a save');
});

test('Pay rates: owner sees the screen with the visible note and history; save sends the exact arguments; the button follows the typed values', async () => {
  const RATES = { ok: true, today: TODAY, next: null,
    in_force: { id: 'r3', effective_from: '2026-09-30', regular_rate: 500, general_rate: 1000, transport_rate: 150, note: 'D-298.1', created_at: 'x' },
    history: [{ id: 'r3', effective_from: '2026-09-30', regular_rate: 500, general_rate: 1000, transport_rate: 150, note: 'D-298.1' }, { id: 'r2', effective_from: '2026-05-07', regular_rate: 650, general_rate: 1000, transport_rate: null, note: 'Honey' }] };
  const app = await boot({ role: 'owner', hash: '#payrates', handlers: { current_staff_access: () => ACCESS('owner'), staff_home_v1: () => HOME, tasks_list_v1: () => ({ error: null, data: ADMIN_TASKS }),
    admin_pay_rates_v1: () => ({ error: null, data: RATES }), admin_add_pay_rate_v1: () => ({ error: null, data: { ok: true, id: 'r4', replayed: false } }) } });
  const html = app.els['v-payrates'].innerHTML;
  assert.match(html, /The staff app and payment requests use these rates/);
  assert.match(html, /₱500 per clean · ₱1,000 per deep clean · ₱150 transport when ticked/);
  assert.match(html, /transport included/, 'the 650 era row says transport is included');
  assert.match(html, /id="r-from"[^>]*min="2026-10-06"/);
  await app.click({ 'data-act': 'rate-save' });
  assert.ok(!app.calls.some((c) => c[0] === 'admin_add_pay_rate_v1'), 'nothing is sent while the form is empty');
  app.input('r-regular', '520'); app.input('r-general', '1050'); app.input('r-transport', '160'); app.input('r-note', 'Honey agreed a raise');
  await app.click({ 'data-act': 'rate-save' });
  assert.deepEqual(app.calls.find((c) => c[0] === 'admin_add_pay_rate_v1')[1], { p_property_id: 'prop-1', p_effective_from: '2026-10-06', p_regular: 520, p_general: 1050, p_transport: 160, p_note: 'Honey agreed a raise' });
});

test('Pay rates: finance and staff are sent home and never call the rate RPCs; the admin home lists Pay rates only for owner and admin', async () => {
  for (const role of ['finance', 'cleaner']) {
    const app = await boot({ role, hash: '#payrates', handlers: { current_staff_access: () => ACCESS(role), staff_home_v1: () => HOME, tasks_list_v1: () => ({ error: null, data: STAFF_TASKS }) } });
    assert.ok(!app.calls.some((c) => c[0] === 'admin_pay_rates_v1'), role + ' never reads pay rates');
    assert.equal(app.location.hash, '#payrates'); // the URL is left alone, the screen is the home screen
    assert.doesNotMatch(app.els['v-home'].innerHTML, /Pay rates/);
  }
  const adm = await boot({ role: 'admin', hash: '#home', handlers: { current_staff_access: () => ACCESS('admin'), staff_home_v1: () => HOME, tasks_list_v1: () => ({ error: null, data: ADMIN_TASKS }) } });
  assert.match(adm.els['v-home'].innerHTML, /href="#payrates"/);
  const fin = await boot({ role: 'finance', hash: '#home', handlers: { current_staff_access: () => ACCESS('finance'), staff_home_v1: () => HOME, tasks_list_v1: () => ({ error: null, data: STAFF_TASKS }) } });
  assert.doesNotMatch(fin.els['v-home'].innerHTML, /href="#payrates"/);
});

test('no pay amount is hard-coded in the app: 500 / 650 / 1,000 / 150 never appear as pesos in the screens or the Payment Request page', () => {
  for (const f of ['app.js', 'index.html', 'pay/pay.js', 'pay/pay-lib.js', 'pay/index.html']) {
    assert.doesNotMatch(read(f), /(₱|&#8369;|PHP\s?)\s?(150|500|650|1,?000)\b/, f);
  }
  assert.doesNotMatch(read('quick/index.html'), /Switch on <strong>\+(₱|&#8369;)\s?150/, 'the Quick guide no longer names the transport amount');
});

test('shell: the Tasks tab is a hash route in both layouts, the Payment Request page points its Tasks tab at it, the views exist', () => {
  const app = read('app.js'), html = read('index.html'), pay = read('pay/pay.js');
  assert.match(app, /\['tasks', '#tasks', 'Tasks', 'tasks', due\]/);
  assert.doesNotMatch(app, /\['pay', LINKS\.pay, 'Tasks'/);
  assert.match(html, /id="v-tasks"/); assert.match(html, /id="v-payrates"/); assert.match(html, /<script src="pay\/pay-lib\.js"><\/script>/);
  assert.match(pay, /href="\.\.\/#tasks"/);
  assert.doesNotMatch(pay, /href="\.\/" aria-current="page"><span class="ico">' \+ ICON\('tasks'/);
  assert.match(app, /'tasks', 'payrates', 'more', 'door'/);
});

// ------------------------------------------------------------------------------------------------ s77 guest card contact
const GUEST = { uid: 'u1', guest_name: 'Ana <b>', source: 'direct', checkin_date: TODAY, checkout_date: '2026-10-09', nights: 3 };
const homeWith = (g) => ({ error: null, data: { ...HOME.data, current_guest: g } });

test('guest card: owner/admin see phone (copy, Call), e-mail (copy) and Messenger; everything is escaped', async () => {
  const g = { ...GUEST, phone: '+63 917 <123> 4567', email: 'ana"x@example.com', messenger: { psid: '1', thread_url: 'https://business.facebook.com/latest/inbox/all?selected_item_id=1' } };
  const app = await boot({ role: 'admin', hash: '#calendar', handlers: { current_staff_access: () => ACCESS('admin'), staff_home_v1: () => homeWith(g), tasks_list_v1: () => ({ error: null, data: ADMIN_TASKS }) } });
  const html = app.els['v-calendar'].innerHTML;
  assert.match(html, /data-act="copy" data-copy="\+63 917 &lt;123&gt; 4567"/);
  assert.match(html, /href="tel:\+639171234567"/);
  assert.match(html, /data-copy="ana&quot;x@example.com"/);
  assert.match(html, /href="https:\/\/business\.facebook\.com\/latest\/inbox\/all\?selected_item_id=1" target="_blank" rel="noopener"/);
  assert.match(html, /Open in Messenger/);
  assert.doesNotMatch(html, /<123>|Ana <b>/, 'nothing raw');
});

test('guest card: no contact fields means no contact block; a contact key for a cleaner still blocks the page', async () => {
  const bare = await boot({ role: 'admin', hash: '#calendar', handlers: { current_staff_access: () => ACCESS('admin'), staff_home_v1: () => homeWith(GUEST), tasks_list_v1: () => ({ error: null, data: ADMIN_TASKS }) } });
  assert.doesNotMatch(bare.els['v-calendar'].innerHTML, /ctbox|Open in Messenger|tel:/);
  const onlyM = await boot({ role: 'owner', hash: '#calendar', handlers: { current_staff_access: () => ACCESS('owner'), staff_home_v1: () => homeWith({ ...GUEST, messenger: { psid: '1' } }), tasks_list_v1: () => ({ error: null, data: ADMIN_TASKS }) } });
  assert.match(onlyM.els['v-calendar'].innerHTML, /href="https:\/\/business\.facebook\.com\/latest\/inbox\/all"/, 'no thread url: the Page inbox');
  assert.doesNotMatch(onlyM.els['v-calendar'].innerHTML, /tel:|data-act="copy"/);
  const cleaner = await boot({ role: 'cleaner', hash: '#calendar', handlers: { current_staff_access: () => ACCESS('cleaner'), staff_home_v1: () => homeWith({ ...GUEST, phone: '0917' }), tasks_list_v1: () => ({ error: null, data: STAFF_TASKS }) } });
  assert.match(cleaner.els['v-calendar'].innerHTML, /blocked because the data carried an amount or a contact detail/);
});

test('copy: tapping a value writes it to the clipboard and says Copied; a refused clipboard says how to copy by hand', async () => {
  const wrote = [];
  const app = await boot({ role: 'admin', hash: '#calendar', nav: { clipboard: { writeText: (t) => { wrote.push(t); return Promise.resolve(); } } },
    handlers: { current_staff_access: () => ACCESS('admin'), staff_home_v1: () => homeWith({ ...GUEST, phone: '0917 123 4567' }), tasks_list_v1: () => ({ error: null, data: ADMIN_TASKS }) } });
  await app.click({ 'data-act': 'copy', 'data-copy': '0917 123 4567' });
  assert.deepEqual(wrote, ['0917 123 4567']);
  assert.equal(app.els['cs-toast'].textContent, 'Copied');
  const no = await boot({ role: 'admin', hash: '#calendar', nav: { clipboard: { writeText: () => Promise.reject(new Error('denied')) } },
    handlers: { current_staff_access: () => ACCESS('admin'), staff_home_v1: () => homeWith(GUEST), tasks_list_v1: () => ({ error: null, data: ADMIN_TASKS }) } });
  await no.click({ 'data-act': 'copy', 'data-copy': 'x' });
  assert.match(no.els['cs-toast'].textContent, /Press and hold/);
});
