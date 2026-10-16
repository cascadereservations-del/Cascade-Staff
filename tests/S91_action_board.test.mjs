// s91: Home "Needs action" for owner, admin and finance (replaces their Notices card). app.js against the stub DOM and a fake client, frozen clock (15 Oct 2026, 12:30 Manila).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CS, D, NOW, boot, HOMEWITH, NOTICES_RAW, baseHandlers, stayRow, TODAY } from './_a_harness.mjs';

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
    staff_inquiry_payments_v1: () => ({ error: null, data: new Array(o.bookings || 0).fill(o.oldest ? { created_at: o.oldest } : {}) }),
    staff_pay_admin_list_v1: () => ({ error: null, data: { ok: true, requests: new Array(o.pay || 0).fill({ status: 'requested' }) } }),
    admin_review_queue_v1: () => ({ error: null, data: { count: o.review || 0, total: '0.00', truncated: false, rows: [] } }) }, o.over || {}));
};
const home = (app) => app.els['v-home'].innerHTML;
const card = (app) => (/<section class="card glass A_card B_card".*?<\/section>/s.exec(home(app)) || [''])[0];
const rowsOf = (c) => [...c.matchAll(/<li class="B_row[^>]*>.*?<\/li>/gs)].map((m) => m[0]);
const pillN = (app) => { const m = /class="E_cnt">(\d+) to look at</.exec(home(app)); return m ? +m[1] : 0; };
const boardN = (app) => { const m = /class="count B_total" aria-hidden="true">(\d+)</.exec(card(app)); return m ? +m[1] : 0; };
const own = async (o, role) => boot({ role: role || 'owner', hash: '#home', handlers: sources(role || 'owner', o) });

test('s91 board: each source is one row whose whole row is the action, with plain words in the title (owner and admin)', async () => {
  const cases = [
    [{ tasks: [T()] }, [/Overdue: 1 task/, /href="#tasks" data-act="attn-tasks" data-filter="due"/]],
    [{ tasks: [T({ blocks_arrival: true })] }, [/At risk: Fix the gate latch/]],
    [{ calendar: CLASH }, [/Clash: Ann and Bo overlap/, /21-22 Oct · 2 nights · one booking needs to move/, /data-act="notice-cal" data-date="2026-10-21"/]],
    [{ bookings: 2, oldest: '2026-10-12T03:00:00Z' }, [/2 bookings to confirm/, /Oldest waiting since 12 Oct/, /href="#manage\/inquiries"/]],
    [{ pay: 1 }, [/1 pay request waiting/, /href="\.\/pay\/admin\.html[^"]*"/]],
    [{ review: 3 }, [/3 transactions to review/, /href="#manage\/money"/]],
    [{ inbox: 2 }, [/2 open messages/, /href="#inbox"/]],
    [{ house: [FIND] }, [/Door sensor offline/, /Found by the nightly check/, /aria-label="Mark handled: Door sensor offline"/]],
    [{ house: [STOCK] }, [/Towels: 2 left/, /href="#stock"/]],
    [{ warnings: [{ kind: 'inventory', title: 'Low stock: dish soap', detail: { qty: 1, unit: 'pc', reorder_below: 3 } }] }, [/Dish soap: 1 pc left \(reorder at 3\)/, /href="#stock"/]],
    [{ house: [FIND, { kind: 'finding', id: 'V8:x', title: 'Cam offline' }] }, [/2 system checks/]],
    [{ house: [STOCK, { kind: 'low_stock', id: 's2', title: 'Low stock: soap', detail: '1 left' }, { kind: 'low_stock', id: 's3', title: 'Low stock: bulbs', detail: '1 left' }] }, [/3 items low/]],
  ];
  for (const role of ['owner', 'admin']) for (const [o, res] of cases) {
    const app = await own(Object.assign({ notices: [] }, o), role), c = card(app), rows = rowsOf(c);
    assert.equal(rows.length, 1, role + ' ' + JSON.stringify(Object.keys(o)) + ': one row'); for (const re of res) assert.match(c, re);
    assert.match(rows[0], /<(a|button|div) class="rowi"[^>]*aria-describedby="B_s0"/); assert.doesNotMatch(c, /B_word|btn-primary/, 'no kicker and no big button');
    assert.equal(boardN(app), pillN(app), 'pill = card');
  }
});

test('s91 board: only a single finding has the trailing Mark handled; a folded group has none', async () => {
  const one = card(await own({ house: [FIND] })), two = card(await own({ house: [FIND, { kind: 'finding', id: 'V8:x', title: 'Cam offline' }] }));
  assert.match(one, /<button class="iconbtn" type="button" data-act="board-ask" data-bkey="find:V9:abc" aria-label="Mark handled: Door sensor offline">/); assert.doesNotMatch(two, /Mark handled/);
});

test('s91 board: tier 1 and tier 2 put the card above Turnover; otherwise it sits under it; brownouts are Heads-up only', async () => {
  const above = home(await own({ tasks: [T()] })), at = (h) => [h.indexOf('aria-label="Needs action"'), h.indexOf('aria-label="Turnover today"')];
  assert.ok(at(above)[0] > 0 && at(above)[0] < at(above)[1], 'overdue: above Turnover');
  const guest = home(await own({ inbox: 1 })); assert.ok(at(guest)[0] < at(guest)[1], 'a guest waiting: above');
  const under = home(await own({ review: 2 })); assert.ok(at(under)[0] > at(under)[1], 'information only: under Turnover');
  const b = await own({ warnings: [{ kind: 'brownout', title: 'SOCOTECO II', detail: { date: '2026-10-16', time: '13:00', hours: 3 } }] });
  assert.equal(boardN(b), 0); assert.equal(pillN(b), 0); assert.match(card(b), /Heads-up|Brownout 1:00 to 4:00 pm/); assert.doesNotMatch(card(b), /Nothing needs you right now\.<\/b>[^]*At risk/);
});

test('s91 board: tiers order the rows, at most 5 rows, the rest is "See all N", and the weights add up to the pill', async () => {
  const app = await own({ tasks: [T()], calendar: CLASH, bookings: 2, pay: 1, review: 3, inbox: 2, house: [FIND, STOCK] }), c = card(app), rows = rowsOf(c);
  const action = rows.filter((r) => !/heads-toggle/.test(r));
  assert.ok(action.length <= 5, 'at most 5 action rows'); assert.match(action[action.length - 1], /See all \d+/); assert.match(action[action.length - 1], /data-act="attn-open"/);
  assert.ok(/Overdue/.test(action[0]) && /open messages/.test(action[1]) && /to confirm/.test(action[2]) && /Clash/.test(action[3]), 'red, then a guest waiting (inbox, then bookings), then later clash');
  assert.equal(boardN(app), pillN(app)); assert.equal(pillN(app), 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1);
});

test('s91 board: a clash is one row per PAIR of bookings, not per night', async () => {
  const a = CS.A_board(CS.E_attention({ role: 'owner', today: TODAY, ready: { payload: true, tasks: true, bookings: true, notices: true }, clashes: [
    { key: 'p1', a: 'Ann', b: 'Bo', from: '2026-10-20', to: '2026-10-22', nights: 3, first: '2026-10-20' }, { key: 'p2', a: 'Cy', b: 'Di', from: '2026-10-17', to: '2026-10-17', nights: 1, first: '2026-10-17' }] }));
  assert.equal(a.rows.length, 2); assert.equal(a.rows[0].tier, 1, 'within 3 days: red, first'); assert.match(a.rows[0].sub, /^17 Oct · 1 night/); assert.match(a.rows[1].sub, /^20-22 Oct · 3 nights/);
});

test('s91 board: finance sees bookings, pay and review only', async () => {
  const app = await own({ tasks: [T()], bookings: 2, pay: 1, review: 3, inbox: 2, house: [FIND, STOCK], notices: [MANUAL] }, 'finance'), c = card(app);
  assert.match(c, /2 bookings to confirm/); assert.match(c, /1 pay request waiting/); assert.match(c, /3 transactions to review/);
  assert.doesNotMatch(c, /open messages|Mark handled|Close notice|Add a notice|Door sensor|Towels/); assert.equal(boardN(app), pillN(app));
  assert.ok(app.calls.some((x) => x[0] === 'admin_review_queue_v1'));
});

test('s91 board: the cleaner keeps the Notices card and never loads the review queue', async () => {
  const app = await own({ tasks: [T()] }, 'cleaner'), h = home(app);
  assert.match(h, /A_noticecard/); assert.doesNotMatch(h, /B_card|Needs action/); assert.ok(!app.calls.some((x) => x[0] === 'admin_review_queue_v1'));
});

test('s91 board: nothing to do reads "Nothing needs you right now." with the last-checked time; a missing review queue is not an error', async () => {
  const app = await own({ over: { admin_review_queue_v1: () => ({ error: { code: 'PGRST202', message: 'x' }, data: null }) } }), c = card(app);
  assert.match(c, /Nothing needs you right now\./); assert.match(c, /Last checked 12:30/); assert.equal(boardN(app), 0); assert.match(home(app), /E_lbl">All clear/);
});

test('s91 board: Mark handled asks in place (focus on the confirm), calls ack_verifier_finding_v1, and the row leaves the card and the pill', async () => {
  let gone = false;
  const app = await own({ house: [FIND], over: { notices_v1: () => ({ error: null, data: NOTICES_RAW({ role: 'owner', house: gone ? [] : [FIND] }) }), ack_verifier_finding_v1: () => { gone = true; return { ok: true }; } } });
  assert.equal(pillN(app), 1);
  await app.click({ 'data-act': 'board-ask', 'data-bkey': 'find:V9:abc' });
  assert.match(card(app), /<li class="B_row B_confirm"[^>]*>.*Mark this handled\?.*id="B_yes"[^>]*>Mark handled<\/button><button[^>]*>Keep<\/button>/s); assert.ok(!app.calls.some((x) => x[0] === 'ack_verifier_finding_v1'), 'nothing is sent before the yes');
  await app.click({ 'data-act': 'board-yes', 'data-bkey': 'find:V9:abc' });
  const ack = app.calls.filter((x) => x[0] === 'ack_verifier_finding_v1'); assert.equal(ack.length, 1); assert.deepEqual(ack[0][1], { p_key: 'V9:abc' });
  assert.doesNotMatch(card(app), /Door sensor offline/); assert.match(card(app), /<p class="B_msg">Marked handled\./); assert.equal(pillN(app), 0);
  assert.ok(!app.els['cs-toast'] || !app.els['cs-toast'].textContent, 'no second announcement: the message line is the only one');
});

test('s91 board: Keep cancels without a call', async () => {
  const app = await own({ house: [FIND] }); await app.click({ 'data-act': 'board-ask', 'data-bkey': 'find:V9:abc' }); await app.click({ 'data-act': 'board-no' });
  assert.match(card(app), /Door sensor offline/); assert.doesNotMatch(card(app), /B_confirm/); assert.ok(!app.calls.some((x) => x[0] === 'ack_verifier_finding_v1'));
});

test('s91 board: a Mark handled that fails keeps the row and says why', async () => {
  const app = await own({ house: [FIND], over: { ack_verifier_finding_v1: () => ({ error: { code: '500', message: 'boom' }, data: null }) } });
  await app.click({ 'data-act': 'board-ask', 'data-bkey': 'find:V9:abc' }); await app.click({ 'data-act': 'board-yes', 'data-bkey': 'find:V9:abc' });
  assert.match(card(app), /Door sensor offline/); assert.match(card(app), /That did not save\. Check your signal and try again\./); assert.equal(boardN(app), pillN(app)); assert.equal(pillN(app), 1);
});

test('s91 board: a verifier warning resolves by its key, and the same finding in notices_v1 is not counted twice', async () => {
  const W = { kind: 'verifier', title: 'Door sensor offline', key: 'V9:abc', detail: { check_id: 'V9' } };
  let acked = false;
  const app = await own({ warnings: [W], house: [FIND], over: { staff_home_v1: () => HOMEWITH([], { warnings: acked ? [] : [W] }),
    notices_v1: () => ({ error: null, data: NOTICES_RAW({ role: 'owner', house: acked ? [] : [FIND] }) }), ack_verifier_finding_v1: () => { acked = true; return { ok: true }; } } });
  assert.equal(pillN(app), 1, 'one finding, one count'); assert.equal(boardN(app), 1);
  const key = /data-act="board-ask" data-bkey="([^"]+)"/.exec(card(app))[1];
  await app.click({ 'data-act': 'board-ask', 'data-bkey': key }); await app.click({ 'data-act': 'board-yes', 'data-bkey': key });
  assert.deepEqual(app.calls.filter((x) => x[0] === 'ack_verifier_finding_v1')[0][1], { p_key: 'V9:abc' }); assert.equal(boardN(app), 0); assert.equal(pillN(app), 0);
});

test('s91 board: a stale staff_home_v1 answer that lands after the write cannot bring the row back, and notices are read once per load', async () => {
  const W = { kind: 'verifier', title: 'Door sensor offline', key: 'V9:abc', detail: { check_id: 'V9' } };
  let acked = false, n = 0, release; const slow = new Promise((r) => { release = r; });
  const app = await own({ warnings: [W], over: { staff_home_v1: () => { n += 1; if (n === 2) return slow.then(() => JSON.parse(JSON.stringify(HOMEWITH([], { warnings: [W] })))); return HOMEWITH([], { warnings: acked ? [] : [W] }); },
    ack_verifier_finding_v1: () => { acked = true; return { ok: true }; } } });
  await app.click({ 'data-act': 'refresh' }); // load 2 is now in flight and will answer with the OLD payload
  const key = /data-act="board-ask" data-bkey="([^"]+)"/.exec(card(app))[1];
  await app.click({ 'data-act': 'board-ask', 'data-bkey': key }); await app.click({ 'data-act': 'board-yes', 'data-bkey': key });
  release(); await app.flush(); await app.flush();
  assert.doesNotMatch(card(app), /Door sensor offline/, 'the row stays gone'); assert.equal(boardN(app), 0); assert.equal(n, 3, 'a third read, taken after the write');
  assert.equal(app.calls.filter((x) => x[0] === 'notices_v1').length, 3, 'one notices read per home load, no extra');
});

test('s91 board: Heads-up: 3+ action rows fold into one expandable row; fewer show at most 2 rows; Close is a trailing 44 px button with a confirm', async () => {
  const many = await own({ tasks: [T()], bookings: 2, inbox: 1, notices: [MANUAL] }), c = card(many);
  assert.match(c, /data-act="heads-toggle" aria-expanded="false"/); assert.match(c, /Heads-up · \d+ notices?/); assert.doesNotMatch(c, /Gate code changed<\/span><span class="s"/, 'collapsed: no notice rows');
  await many.click({ 'data-act': 'heads-toggle' }); assert.match(card(many), /aria-expanded="true"/); assert.match(card(many), /Gate code changed/);
  let closed = false;
  const few = await own({ notices: [MANUAL, ...NOTICES_RAW().notices], over: { notices_v1: () => ({ error: null, data: NOTICES_RAW({ role: 'owner', notices: (closed ? [] : [MANUAL]).concat(NOTICES_RAW().notices) }) }), ops_notice_close_v1: () => { closed = true; return { ok: true, id: 'nm1' }; } } });
  const heads = rowsOf(card(few)); assert.equal(heads.length, 3, 'two notices and a "See all"'); assert.match(card(few), /See all 3 notices/);
  assert.equal((card(few).match(/aria-label="Close notice: /g) || []).length, 1, 'only the hand-added one can be closed'); assert.doesNotMatch(card(few), /Open on calendar/);
  await few.click({ 'data-act': 'board-ask', 'data-bkey': 'n:nm1' }); assert.match(card(few), /Close this notice\?/); assert.ok(!few.calls.some((x) => x[0] === 'ops_notice_close_v1'));
  await few.click({ 'data-act': 'board-yes', 'data-bkey': 'n:nm1' });
  const call = few.calls.filter((x) => x[0] === 'ops_notice_close_v1'); assert.equal(call.length, 1); assert.deepEqual(call[0][1], { p_id: 'nm1', p_property_id: 'prop-1' });
  assert.doesNotMatch(card(few), /Gate code changed/); assert.match(card(few), /Notice closed\./);
  assert.equal(few.calls.filter((x) => x[0] === 'staff_home_v1').length, 1, 'closing a notice re-reads notices only');
});

test('s91 board: a Close that fails, or whose function is not deployed yet, keeps the notice and says so', async () => {
  for (const [err, msg] of [[{ code: '500', message: 'boom' }, /That did not save/], [{ code: 'PGRST202', message: 'x' }, /Available after the next update\./], [{ code: '42501', message: 'no' }, /Only an owner or admin/]]) {
    const app = await own({ notices: [MANUAL], over: { ops_notice_close_v1: () => ({ error: err, data: null }) } });
    await app.click({ 'data-act': 'board-ask', 'data-bkey': 'n:nm1' }); await app.click({ 'data-act': 'board-yes', 'data-bkey': 'n:nm1' });
    assert.match(card(app), /Gate code changed/); assert.match(card(app), msg);
  }
});

test('s91 board: the Home button reads as a sentence for a count-led group, and is a ghost when the board carries the at-risk row', async () => {
  const rv = home(await own({ review: 3 })); assert.match(rv, /data-primary="attention"[^>]*>3 transactions to review</); assert.doesNotMatch(rv, /Review 3 to review|Review 3 transactions/);
  const risk = home(await own({ tasks: [T({ blocks_arrival: true })] })); assert.match(risk, /<button class="btn btn-ghost btn-block A_primary" type="button" data-primary="attention"/);
  const other = home(await own({ review: 3 })); assert.match(other, /<button class="btn btn-primary btn-block A_primary" type="button" data-primary="attention"/);
});

test('s91 board: counts are aria-hidden numbers with .sr text, and nothing but the message line announces board actions', async () => {
  const app = await own({ bookings: 2, house: [FIND] });
  assert.match(card(app), /<p class="B_msg">/); assert.match(card(app), /class="count B_total" aria-hidden="true">2<\/span><span class="sr">2 things need action/);
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8'); for (const v of ['home', 'calendar', 'tasks']) assert.doesNotMatch(html, new RegExp('id="v-' + v + '"[^>]*aria-live'));
  const css = fs.readFileSync(new URL('../styles.css', import.meta.url), 'utf8'), b = css.slice(css.indexOf('/* s91 Needs action'));
  assert.match(b, /\.B_row > \.rowi \{ min-height: 64px/); assert.match(b, /\.B_confirm \.btn \{ flex: 1 1 0; min-width: 0; min-height: var\(--touch\)/); assert.doesNotMatch(b, /#[0-9a-fA-F]{3,8}\b|rgba?\(|font-size:\s*\d+px/);
});

test('s91 board: the demo owner gets at most 5 action rows and one Heads-up row, and Mark handled in the demo drops the row', async () => {
  const c0 = D.client('owner', NOW), handlers = new Proxy({}, { get: (t, name) => (args) => c0.rpc(String(name), args) });
  const app = await boot({ role: 'owner', hash: '#home', demo: true, handlers }), c = card(app), rows = rowsOf(c);
  const heads = rows.filter((r) => /heads-toggle/.test(r)), action = rows.filter((r) => !/heads-toggle/.test(r));
  assert.ok(action.length >= 3 && action.length <= 5, 'demo action rows: ' + action.length); assert.equal(heads.length, 1);
  assert.equal(boardN(app), pillN(app));
  const m = /data-act="board-ask" data-bkey="([^"]+)"/.exec(c);
  if (m) { await app.click({ 'data-act': 'board-ask', 'data-bkey': m[1] }); await app.click({ 'data-act': 'board-yes', 'data-bkey': m[1] }); assert.ok(boardN(app) < pillN(app) + 1); assert.doesNotMatch(card(app), /Demo check: Airbnb block runs past/); }
});

test('s91 A_board: the weights add up to the pill count for any mix, and notices are never rows', () => {
  const att = CS.E_attention({ role: 'owner', today: TODAY, ready: { payload: true, tasks: true, bookings: true, notices: true }, info: true,
    tasks: [T({ id: 'a' }), T({ id: 'b' }), T({ id: 'c', blocks_arrival: true })], clashes: [1, 2, 3, 4, 5, 6].map((i) => ({ key: 'k' + i, a: 'A' + i, b: 'B' + i, from: '2026-10-2' + i, to: '2026-10-2' + i, nights: 1, first: '2026-10-2' + i })),
    bookings: 4, inbox: 1, pay: 2, review: 5, warnings: [], house: [FIND, STOCK], notices: [{ key: 'n:1', type: 'note', title: 'x', date: TODAY }] });
  const b = CS.A_board(att); assert.equal(b.n, att.n); assert.equal(b.rows.reduce((a, r) => a + r.weight, 0), att.n);
  assert.ok(b.rows.length <= 5 && b.rows[b.rows.length - 1].more); assert.ok(!b.rows.some((r) => r.group === 'notice'));
});

test('s91 board: the message is plain text on the card and is announced by the persistent live region outside the view (success and failure)', async () => {
  let gone = false;
  const ok = await own({ house: [FIND], over: { notices_v1: () => ({ error: null, data: NOTICES_RAW({ role: 'owner', house: gone ? [] : [FIND] }) }), ack_verifier_finding_v1: () => { gone = true; return { ok: true }; } } });
  await ok.click({ 'data-act': 'board-ask', 'data-bkey': 'find:V9:abc' }); await ok.click({ 'data-act': 'board-yes', 'data-bkey': 'find:V9:abc' });
  assert.match(card(ok), /<p class="B_msg">Marked handled\./); assert.doesNotMatch(card(ok), /B_msg" role|aria-live/); assert.equal(ok.els['E_attn-live'].textContent, 'Marked handled.');
  const bad = await own({ house: [FIND], over: { ack_verifier_finding_v1: () => ({ error: { code: '500', message: 'boom' }, data: null }) } });
  await bad.click({ 'data-act': 'board-ask', 'data-bkey': 'find:V9:abc' }); await bad.click({ 'data-act': 'board-yes', 'data-bkey': 'find:V9:abc' });
  assert.equal(bad.els['E_attn-live'].textContent, 'That did not save. Check your signal and try again.');
});

test('s91 board: a redraw of Home puts focus back where it was (Keep returns to its row button, Heads-up toggle stays), and the confirm row stays one line', async () => {
  const asked = []; let active = null;
  const el = (attrs) => ({ id: attrs.id || '', className: attrs.cls || '', getAttribute: (n) => (n in attrs ? attrs[n] : null), closest: (q) => (q === '#v-home' ? {} : attrs.li ? { getAttribute: () => attrs.li } : null), focus() {} });
  const app = await boot({ role: 'owner', hash: '#home', activeEl: () => active, docQuery: (q) => { asked.push(q); return { focus() {} }; }, handlers: sources('owner', { house: [FIND] }) });
  asked.length = 0; active = el({ 'data-act': 'heads-toggle' }); await app.click({ 'data-act': 'refresh' }); assert.ok(asked.includes('[data-act="heads-toggle"]'), 'the Heads-up toggle');
  asked.length = 0; active = el({ 'data-act': 'attn-open' }); await app.click({ 'data-act': 'board-ask', 'data-bkey': 'find:V9:abc' }); await app.click({ 'data-act': 'board-no' });
  assert.ok(asked.includes('[data-act="board-ask"][data-bkey="find:V9:abc"]'), 'Keep goes back to Mark handled of the same row');
  asked.length = 0; active = el({ cls: 'rowi', li: 'find:V9:abc' }); await app.click({ 'data-act': 'refresh' }); assert.ok(asked.includes('[data-bkey="find:V9:abc"] .rowi'), 'a row link keeps focus through a late redraw');
  const css = fs.readFileSync(new URL('../styles.css', import.meta.url), 'utf8'); assert.match(css, /\.B_confirm \{ display: flex; flex-wrap: nowrap;[^}]*min-height: 64px/);
  assert.match(fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8'), /data-act="notice-resolve" data-id="' \+ esc\(h\.id\) \+ '">Mark handled<\/button>/, 'the Notices tab says Mark handled too');
});
