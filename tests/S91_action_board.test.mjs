// s91: Home "Needs action" for owner, admin and finance (replaces their Notices card). app.js against the stub DOM and a fake client, frozen clock (15 Oct 2026, 12:30 Manila).
import test from 'node:test';
import assert from 'node:assert/strict';
import { CS, boot, HOMEWITH, NOTICES_RAW, baseHandlers, stayRow, TODAY } from './_a_harness.mjs';

const T = (o) => Object.assign({ source: 'follow_up_tasks', id: 'a', kind: 'reminder', title: 'Fix the gate latch', priority: 'normal', status: 'open', due_at: '2026-10-12T09:00:00Z', mine: true, blocks_arrival: false, detail: null, assignee_label: null, created_at: '2026-10-01T00:00:00Z' }, o);
const tasksOf = (list) => () => ({ error: null, data: { ok: true, manager: true, today: TODAY, tasks: list } });
const CLASH = [stayRow('Ann', '2026-10-20', '2026-10-23'), stayRow('Bo', '2026-10-21', '2026-10-24')];
const FIND = { kind: 'finding', id: 'V9:abc', title: 'Door sensor offline', detail: 'Seen two days ago' };
const STOCK = { kind: 'low_stock', id: 's1', title: 'Low stock: towels', detail: '2 left' };
const MANUAL = { id: 'nm1', type: 'note', title: 'Gate code changed', date: '2026-10-18', source: 'manual', detail: 'Ask the cleaners' };
const sources = (role, o) => {
  o = o || {};
  const house = o.house || [], notices = o.notices || NOTICES_RAW().notices;
  return baseHandlers(role, Object.assign({
    staff_home_v1: () => HOMEWITH(o.calendar || [], { warnings: o.warnings || [] }),
    tasks_list_v1: tasksOf(o.tasks || []),
    notices_v1: () => ({ error: null, data: NOTICES_RAW({ role, house: house.slice(), notices, inbox_open: o.inbox == null ? 0 : o.inbox }) }),
    staff_inquiry_payments_v1: () => ({ error: null, data: new Array(o.bookings || 0).fill({}) }),
    staff_pay_admin_list_v1: () => ({ error: null, data: { ok: true, requests: new Array(o.pay || 0).fill({ status: 'requested' }) } }),
    admin_review_queue_v1: () => ({ error: null, data: { count: o.review || 0, total: '0.00', truncated: false, rows: [] } }) }, o.over || {}));
};
const card = (app) => (/<section class="card glass A_card B_card".*?<\/section>/s.exec(app.els['v-home'].innerHTML) || [''])[0];
const pillN = (app) => { const m = /class="E_cnt">(\d+) to look at</.exec(app.els['v-home'].innerHTML); return m ? +m[1] : 0; };
const boardN = (app) => { const m = /class="count B_total" aria-label="(\d+) things? needs? action"/.exec(card(app)); return m ? +m[1] : 0; };
const FULL = { tasks: [T({ id: 't1' })], calendar: CLASH, bookings: 2, pay: 1, review: 3, inbox: 2, house: [FIND, STOCK],
  warnings: [{ kind: 'brownout', title: 'SOCOTECO II', detail: { date: '2026-10-16', time: '13:00', hours: 3 } }] };

test('s91 board: every source shows with its own action for the owner and the admin, most urgent first, and the pill agrees with the card', async () => {
  for (const role of ['owner', 'admin']) {
    const app = await boot({ role, hash: '#home', handlers: sources(role, FULL) }), c = card(app);
    assert.ok(c, role + ': the Needs action card'); assert.doesNotMatch(app.els['v-home'].innerHTML, /A_noticecard/);
    assert.match(c, /href="#tasks" data-act="attn-tasks" data-filter="due">Open tasks/); assert.match(c, /1 task overdue/);
    assert.match(c, /data-act="notice-cal" data-date="2026-10-21">Open day/);
    assert.match(c, /2 bookings to confirm/); assert.match(c, /href="#manage\/inquiries">Review/);
    assert.match(c, /1 pay request waiting/); assert.match(c, /href="\.\/pay\/admin\.html[^"]*">Pay staff/);
    assert.match(c, /3 transactions to review/); assert.match(c, /href="#manage\/money">Review/);
    assert.match(c, /2 open messages/); assert.match(c, /href="#inbox">Open inbox/);
    assert.match(c, /Brownout/); assert.match(c, /href="#calendar\/notices">See notice/);
    assert.match(c, /Door sensor offline/); assert.match(c, /data-act="board-ask" data-bkey="find:V9:abc">[^R]*Resolve/); assert.match(c, /href="#tasks">Open/);
    assert.match(c, /Low stock: towels/); assert.match(c, /href="#stock">Restock/);
    assert.ok(c.indexOf('overdue') < c.indexOf('to confirm') && c.indexOf('to confirm') < c.indexOf('Door sensor offline'), 'most urgent first');
    assert.match(c, /Heads-up/); assert.match(c, /<span class="B_word">[^<]+<\/span>/, 'each row has a word, not colour alone');
    assert.ok(pillN(app) > 0); assert.equal(boardN(app), pillN(app), 'pill count equals the card count');
  }
});

test('s91 board: finance sees bookings, pay and review only; no inbox, resolve, close or add', async () => {
  const app = await boot({ role: 'finance', hash: '#home', handlers: sources('finance', FULL) }), c = card(app);
  assert.ok(c); assert.match(c, /2 bookings to confirm/); assert.match(c, /1 pay request waiting/); assert.match(c, /3 transactions to review/);
  assert.doesNotMatch(c, /open messages|Resolve|Close notice|Add a notice|Door sensor|Low stock: towels/);
  assert.equal(boardN(app), pillN(app));
  const calls = app.calls.map((x) => x[0]); assert.ok(calls.includes('admin_review_queue_v1'));
});

test('s91 board: the cleaner keeps the Notices card and never loads the review queue', async () => {
  const app = await boot({ role: 'cleaner', hash: '#home', handlers: sources('cleaner', FULL) }), h = app.els['v-home'].innerHTML;
  assert.match(h, /A_noticecard/); assert.doesNotMatch(h, /B_card|Needs action/); assert.ok(!app.calls.some((x) => x[0] === 'admin_review_queue_v1'));
});

test('s91 board: nothing to do reads "Nothing needs you right now." with the last-checked time; a missing review queue is not an error', async () => {
  const app = await boot({ role: 'owner', hash: '#home', handlers: sources('owner', { over: { admin_review_queue_v1: () => ({ error: { code: 'PGRST202', message: 'x' }, data: null }) } }) }), c = card(app);
  assert.match(c, /Nothing needs you right now\./); assert.match(c, /Last checked 12:30/); assert.equal(boardN(app), 0); assert.match(app.els['v-home'].innerHTML, /E_lbl">All clear/);
});

test('s91 board: Resolve asks first, calls ack_verifier_finding_v1, and the row leaves the card and the pill', async () => {
  let gone = false;
  const app = await boot({ role: 'owner', hash: '#home', handlers: sources('owner', { house: [FIND], over: {
    notices_v1: () => ({ error: null, data: NOTICES_RAW({ role: 'owner', house: gone ? [] : [FIND] }) }), ack_verifier_finding_v1: () => { gone = true; return { ok: true }; } } }) });
  assert.equal(pillN(app), 1); assert.match(card(app), /Door sensor offline/);
  await app.click({ 'data-act': 'board-ask', 'data-bkey': 'find:V9:abc' });
  assert.match(card(app), /Mark this as handled\?/); assert.ok(!app.calls.some((x) => x[0] === 'ack_verifier_finding_v1'), 'nothing is sent before the yes');
  await app.click({ 'data-act': 'board-yes', 'data-bkey': 'find:V9:abc' });
  const ack = app.calls.filter((x) => x[0] === 'ack_verifier_finding_v1'); assert.equal(ack.length, 1); assert.deepEqual(ack[0][1], { p_key: 'V9:abc' });
  assert.doesNotMatch(card(app), /Door sensor offline/); assert.match(card(app), /Marked as handled\./); assert.match(card(app), /Nothing needs you right now/); assert.equal(pillN(app), 0);
  await app.click({ 'data-act': 'board-no' });
});

test('s91 board: a Resolve that fails keeps the row and says why', async () => {
  const app = await boot({ role: 'owner', hash: '#home', handlers: sources('owner', { house: [FIND], over: { ack_verifier_finding_v1: () => ({ error: { code: '500', message: 'boom' }, data: null }) } }) });
  await app.click({ 'data-act': 'board-ask', 'data-bkey': 'find:V9:abc' }); await app.click({ 'data-act': 'board-yes', 'data-bkey': 'find:V9:abc' });
  assert.match(card(app), /Door sensor offline/); assert.match(card(app), /That did not save\. Check your signal and try again\./); assert.equal(boardN(app), pillN(app)); assert.equal(pillN(app), 1);
});

test('s91 board: a verifier warning from the payload resolves by its key, and the same finding in notices_v1 is not counted twice', async () => {
  const W = { kind: 'verifier', title: 'Door sensor offline', key: 'V9:abc', detail: { check_id: 'V9' } };
  let acked = false;
  const app = await boot({ role: 'admin', hash: '#home', handlers: sources('admin', { warnings: [W], house: [FIND], over: {
    staff_home_v1: () => HOMEWITH([], { warnings: acked ? [] : [W] }), notices_v1: () => ({ error: null, data: NOTICES_RAW({ role: 'admin', house: acked ? [] : [FIND] }) }), ack_verifier_finding_v1: () => { acked = true; return { ok: true }; } } }) });
  assert.equal(pillN(app), 1, 'one finding, one count'); assert.equal(boardN(app), 1);
  const key = /data-act="board-ask" data-bkey="([^"]+)"/.exec(card(app))[1];
  await app.click({ 'data-act': 'board-ask', 'data-bkey': key }); await app.click({ 'data-act': 'board-yes', 'data-bkey': key });
  assert.deepEqual(app.calls.filter((x) => x[0] === 'ack_verifier_finding_v1')[0][1], { p_key: 'V9:abc' }); assert.equal(boardN(app), 0); assert.equal(pillN(app), 0);
});

test('s91 board: a hand-added notice can be closed (with a confirm); an automatic one cannot', async () => {
  let closed = false;
  const list = () => (closed ? [] : [MANUAL]).concat(NOTICES_RAW().notices);
  const app = await boot({ role: 'owner', hash: '#home', handlers: sources('owner', { over: {
    notices_v1: () => ({ error: null, data: NOTICES_RAW({ role: 'owner', notices: list() }) }), ops_notice_close_v1: () => { closed = true; return { ok: true, id: 'nm1' }; } } }) });
  const c = card(app); assert.match(c, /Gate code changed/); assert.match(c, /Ask the cleaners/, 'details are shown'); assert.equal((c.match(/Close notice/g) || []).length, 1, 'only the hand-added one');
  await app.click({ 'data-act': 'board-ask', 'data-bkey': 'n:nm1' }); assert.match(card(app), /Close this notice\?/); assert.ok(!app.calls.some((x) => x[0] === 'ops_notice_close_v1'));
  await app.click({ 'data-act': 'board-yes', 'data-bkey': 'n:nm1' });
  const call = app.calls.filter((x) => x[0] === 'ops_notice_close_v1'); assert.equal(call.length, 1); assert.deepEqual(call[0][1], { p_id: 'nm1', p_property_id: 'prop-1' });
  assert.doesNotMatch(card(app), /Gate code changed/); assert.match(card(app), /Notice closed\./);
});

test('s91 board: a Close that fails, or whose function is not deployed yet, keeps the notice and says so', async () => {
  for (const [err, msg] of [[{ code: '500', message: 'boom' }, /That did not save/], [{ code: 'PGRST202', message: 'x' }, /Available after the next update\./], [{ code: '42501', message: 'no' }, /Only an owner or admin/]]) {
    const app = await boot({ role: 'admin', hash: '#home', handlers: sources('admin', { notices: [MANUAL], over: { ops_notice_close_v1: () => ({ error: err, data: null }) } }) });
    await app.click({ 'data-act': 'board-ask', 'data-bkey': 'n:nm1' }); await app.click({ 'data-act': 'board-yes', 'data-bkey': 'n:nm1' });
    assert.match(card(app), /Gate code changed/); assert.match(card(app), msg);
  }
});

test('s91 board: the card has an aria-live message line, 44 px actions and tokens only (no raw colour, no px type)', async () => {
  const app = await boot({ role: 'owner', hash: '#home', handlers: sources('owner', FULL) });
  assert.match(card(app), /<p class="B_msg" role="status" aria-live="polite">/);
  const css = (await import('node:fs')).readFileSync(new URL('../styles.css', import.meta.url), 'utf8'), b = css.slice(css.indexOf('/* s91 Needs action'));
  assert.match(b, /\.B_acts \.btn \{ min-height: var\(--touch\); \}/); assert.doesNotMatch(b, /#[0-9a-fA-F]{3,8}\b|rgba?\(|font-size:\s*\d+px/);
});

test('s91 A_board: the weights add up to the pill count for any mix, and notices are never rows', () => {
  const att = CS.E_attention({ role: 'owner', today: TODAY, ready: { payload: true, tasks: true, bookings: true, notices: true },
    tasks: [T({ id: 'a' }), T({ id: 'b' }), T({ id: 'c', blocks_arrival: true })], clashDays: ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'], bookings: 4, inbox: 1, pay: 2, review: 5,
    warnings: [], house: [FIND, STOCK], notices: [{ key: 'n:1', type: 'note', title: 'x', date: TODAY }] });
  const b = CS.A_board(att); assert.equal(b.n, att.n); assert.equal(b.rows.reduce((a, r) => a + r.weight, 0), att.n);
  assert.ok(b.rows.some((r) => r.more && r.weight === 3), 'six clash days: three shown, one "3 more" row'); assert.ok(!b.rows.some((r) => r.group === 'notice'));
});
