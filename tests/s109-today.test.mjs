// s109 (Staff 3.4.24): Today redesign. Internet notices, the utility strip, the standard freebie, task context on system checks, the payment request highlight.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CS, read, boot, HOMEWITH, NOTICES_RAW, baseHandlers, TODAY } from './_a_harness.mjs';

const NOTICE = (o) => Object.assign({ id: 'x', type: 'note', title: 'Note', date: TODAY, start_time: null, end_time: null, source: 'manual', detail: null }, o);
const view = (list) => CS.A_noticesView(NOTICES_RAW({ notices: list }), 'admin', TODAY);

test('s109 notices: a note or maintenance notice naming the internet is an internet notice; power and water keep their type; a plain note stays a note', () => {
  const v = view([NOTICE({ id: 'a', title: 'PLDT fiber maintenance, no internet' }), NOTICE({ id: 'b', type: 'maintenance', title: 'Wi-Fi router replaced' }), NOTICE({ id: 'c', title: 'Buy towels' }), NOTICE({ id: 'd', type: 'power', title: 'Brownout, router off' })]);
  const t = Object.fromEntries(v.list.filter((n) => n.id).map((n) => [n.id, n.type]));
  assert.deepEqual(t, { a: 'internet', b: 'internet', c: 'note', d: 'power' });
  assert.equal(CS.A_NOTICE_TYPES.internet.icon, 'wifioff');
  assert.equal(CS.INTERNET_RE.test('the internet is down'), true); assert.equal(CS.INTERNET_RE.test('Clean the international flag'), false, 'whole words only');
});

test('s109 utility strip: today and tomorrow only, one word per kind, time range when known', () => {
  const tm = CS.addDays(TODAY, 1), later = CS.addDays(TODAY, 3);
  const u = CS.utilAlerts(view([NOTICE({ id: 'p', type: 'power', title: 'Brownout', start_time: '13:00', end_time: '16:00', source: 'socoteco' }), NOTICE({ id: 'w', type: 'water', title: 'No water', date: tm }), NOTICE({ id: 'i', title: 'Converge outage, no internet', date: tm }), NOTICE({ id: 'l', type: 'power', title: 'Brownout', date: later })]), TODAY);
  assert.deepEqual(u.map((x) => [x.type, x.word, x.when.split(' · ')[0]]), [['power', 'Brownout', 'Today'], ['water', 'Water interruption', 'Tomorrow'], ['internet', 'Internet interruption', 'Tomorrow']]);
  assert.match(u[0].when, /Today · 1:00 pm to 4:00 pm/); assert.equal(u[0].source, 'SOCOTECO II');
  assert.deepEqual(CS.utilAlerts(null, TODAY), []);
  assert.equal(CS.H_houseLine(view([NOTICE({ title: 'No internet today' })]), TODAY).text, 'Internet down');
});

test('s109 standard freebie: every guest, first stay included, before arrival; none during the stay of a first stay', () => {
  const F = 'Standard freebie: 2 Kit Kats or an extra bottle of water';
  for (const t of [null, 'first', 'returning', 'regular', 'vip']) assert.ok(CS.tierPerks(t, { phase: 'arrival' }).includes(F), String(t));
  assert.deepEqual(CS.tierPerks(null, { phase: 'house' }), []);
  assert.doesNotMatch(read('lib.js'), /coffee sachets/);
});

test('s109 Cassy reply: info rows show their text in full and copy it; the help line warns Wi-Fi and the address are for booked guests', () => {
  const app = read('app.js');
  assert.match(app, /esc\(l\.info \? l\.url : CS\.clampText/); assert.match(app, /Wi-Fi and the full address are for booked guests only/);
});

const T = (o) => Object.assign({ source: 'verifier_findings', id: 'V3:abc', kind: 'verifier', title: 'Two stays overlap', priority: 'high', status: 'open', due_at: null, mine: false, blocks_arrival: false, detail: null, assignee_label: null, created_at: '2026-10-01T00:00:00Z' }, o);
const tasksOf = (list) => () => ({ error: null, data: { ok: true, manager: true, today: TODAY, tasks: list } });

test('s109 tasks: a system check says what it means, the safe facts, and offers Open the day, the page that fixes it, and Mark handled; restock links to Inventory', async () => {
  const w = { kind: 'verifier', title: 'Two stays overlap', key: 'V3:abc', severity: 'alert', facts: { guest_first: 'Ana', ref: 'HMABC123', from: '2026-10-20', to: '2026-10-22' }, detail: { check_id: 'V3' } };
  const app = await boot({ role: 'admin', hash: '#tasks', handlers: baseHandlers('admin', { staff_home_v1: () => HOMEWITH([], { warnings: [w] }), tasks_list_v1: tasksOf([T({}), T({ source: 'follow_up_tasks', id: 'r1', kind: 'system', title: 'Restock: 14 items are low', priority: 'normal' })]) }) });
  const h = app.els['v-tasks'].innerHTML;
  assert.match(h, /<div class="T_ctx"><p class="T_why">Two confirmed stays share at least one night/);
  assert.match(h, /<li>Guest: Ana<\/li><li>Booking HMABC123<\/li><li>Stay: 20 Oct to 22 Oct<\/li>/);
  assert.match(h, /data-act="notice-cal" data-date="2026-10-20">[\s\S]*?Open 20 Oct<\/button>/);
  assert.match(h, /Go to Bookings calendar/);
  assert.match(h, /data-act="task-done" data-task="verifier_findings:V3:abc">[\s\S]*?Mark handled<\/button>/);
  assert.match(h, /href="#stock">[\s\S]*?Open Inventory<\/a>/);
});

test('s109 tasks: with no matching warning the check still explains itself from its title', async () => {
  const app = await boot({ role: 'admin', hash: '#tasks', handlers: baseHandlers('admin', { tasks_list_v1: tasksOf([T({ id: 'V7:z', title: 'Checkout with no cleaning logged' })]) }) });
  const h = app.els['v-tasks'].innerHTML;
  assert.match(h, /T_why">A guest has checked out and no cleaning is logged/); assert.match(h, /Go to Operations/); assert.doesNotMatch(h, /notice-cal/);
});

test('s109 payment request: owner/admin see who is waiting, how much and when it was sent, with Pay now; nothing when none waits', async () => {
  const LIST = (rows) => () => ({ error: null, data: { ok: true, requests: rows } });
  const rows = [{ id: 'q1', ref: 'R1', status: 'requested', payee_name: 'Marifel', total: 1950, created_at: '2026-10-15T03:10:00Z' }, { id: 'q2', ref: 'R2', status: 'paid', payee_name: 'Honey', total: 500, created_at: '2026-10-14T03:10:00Z' }];
  const app = await boot({ role: 'admin', hash: '#home', handlers: baseHandlers('admin', { staff_pay_admin_list_v1: LIST(rows) }) });
  await new Promise((r) => setTimeout(r, 0));
  const h = app.els['v-home'].innerHTML;
  assert.match(h, /class="card A_card F_span P_alert" role="status"[\s\S]*?Marifel is waiting to be paid[\s\S]*?Marifel · sent today 11:10 am<\/span><b class="num">₱1,950<\/b>[\s\S]*?Pay now<\/a>/);
  assert.doesNotMatch(h, /Honey/, 'a paid request is not shown');
  const none = await boot({ role: 'admin', hash: '#home', handlers: baseHandlers('admin', { staff_pay_admin_list_v1: LIST([rows[1]]) }) });
  await new Promise((r) => setTimeout(r, 0));
  assert.doesNotMatch(none.els['v-home'].innerHTML, /P_alert/);
});

test('s109 layout: the Today sections are labelled, the guest in the house comes before Up next, the strip sits on top', () => {
  const app = read('app.js');
  assert.match(app, /errBanner\(\) \+ A_payBanner\(\) \+ A_utilBar\(\) \+ \(wxTop \? wxCard : ''\) \+ S_sec\('Guests'\) \+ todayCard\(\) \+ nextCard\(\)/);
  assert.match(app, /errBanner\(\) \+ A_utilBar\(\) \+ \(wxTop \? wxCard : ''\) \+ S_sec\('Guests'\) \+ todayCard\(\) \+ nextCard\(\) \+ S_sec\('Turnover'\)/);
  const css = read('styles.css');
  for (const k of ['power', 'water', 'internet']) assert.match(css, new RegExp('\\.U_' + k + ' \\{ background: var\\(--v5-'));
  assert.match(css, /prefers-reduced-motion: reduce\) \{ \.P_alic::after \{ animation: none/);
});
