// Lane E: the notification pill in the hero bar and the "To look at" sheet it opens. app.js against the stub DOM, frozen clock (15 Oct 2026, 12:30 Manila).
import test from 'node:test';
import assert from 'node:assert/strict';
import { CS, read, boot, HOMEWITH, NOTICES_RAW, baseHandlers, TODAY } from './_a_harness.mjs';

const css = read('styles.css'), tokens = read('tokens.css');
const FOLD = { schema: 1, surfaces: { admin: { files: 84 }, checklist: { files: 8 }, manual: { files: 16 }, guide: { files: 48, adminGuide: true } } };
const T = (o) => Object.assign({ source: 'follow_up_tasks', id: 'a', kind: 'reminder', title: 'Shower drain is slow', priority: 'normal', status: 'open', due_at: '2026-10-12T09:00:00Z', mine: true, blocks_arrival: true, detail: null, assignee_label: null, created_at: '2026-10-01T00:00:00Z' }, o);
const tasksOf = (list, manager) => () => ({ error: null, data: { ok: true, manager: !!manager, today: TODAY, tasks: list } });
const home = (extra) => () => HOMEWITH([], extra);
const notices = (role, extra) => () => ({ error: null, data: NOTICES_RAW(Object.assign({ role }, extra || {})) });
const never = new Promise(() => {});
const pillOf = (h) => (/<button class="A_chipglass E_pill"[^>]*>.*?<\/button>/s.exec(h) || [''])[0];
const textOf = (p) => (/class="E_lbl">([^<]*)</.exec(p) || [])[1];
const aria = (p) => (/aria-label="([^"]*)"/.exec(p) || [])[1];

test('E_ pill: present from the first render for owner, admin and cleaner, as Loading, in the same slot as the old chip', async () => {
  for (const role of ['cleaner', 'admin', 'owner']) {
    const app = await boot({ role, hash: '#home', handlers: baseHandlers(role, { staff_home_v1: () => never, tasks_list_v1: () => never }) });
    const h = app.els['v-home'].innerHTML, p = pillOf(h);
    assert.ok(p, role + ': a pill before any data');
    assert.equal(textOf(p), 'Loading'); assert.equal(aria(p), 'Loading what needs attention');
    assert.ok(h.indexOf('class="A_herorow"') < h.indexOf('E_pill') && h.indexOf('E_pill') < h.indexOf('data-act="refresh"'), 'the pill sits left of the Refresh button');
    assert.doesNotMatch(h, /Updated just now<\/span>|class="A_chipglass"[^>]*><i><\/i>/, 'the old "Updated" chip is gone');
  }
});

test('E_ pill: the slot is fixed (124 to 184 px, 44 px tall), the wordmark can shrink, the label folds to "N to look at" under 340 px, and the two new live tokens exist', () => {
  assert.match(css, /button\.A_chipglass\.E_pill \{[^}]*min-width: 124px; max-width: 184px; height: var\(--touch\)/);
  assert.match(css, /\.A_herobar \.brand \{ flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis/);
  assert.match(css, /@media \(max-width: 339px\) \{ \.E_pill \.E_lbl \{ display: none; \} \.E_pill \.E_cnt \{ display: inline; \} button\.A_chipglass\.E_pill \{ max-width: 148px; \} \}/);
  assert.match(css, /\.E_pill \.E_cnt \{ display: none; \}/);
  assert.match(tokens, /--v5-live-bad: #F0646F;/); assert.match(tokens, /--v5-live-idle: #AEBCCB;/);
  assert.match(css, /i\.E_bad \{ background: var\(--v5-live-bad\); \}/); assert.match(css, /i\.E_idle \{ background: var\(--v5-live-idle\); \}/);
  // plain bars: the chip rule that makes it a panel already covers .A_chipglass, so the pill is one too
  assert.match(css, /html\[data-plain="1"\] \.A_chipglass \{ background: var\(--v5-panel\); \}/);
});

test('E_ pill: text and aria-label per state (clear, one, many, no connection), with the short text for narrow phones in a sibling span', async () => {
  const clear = await boot({ role: 'cleaner', hash: '#home', handlers: baseHandlers('cleaner', { staff_home_v1: home(), tasks_list_v1: tasksOf([]) }) });
  let p = pillOf(clear.els['v-home'].innerHTML); assert.equal(textOf(p), 'All clear'); assert.equal(aria(p), 'All clear. Nothing needs attention. Opens the list'); assert.match(p, /E_dot E_ok/);
  const one = await boot({ role: 'cleaner', hash: '#home', handlers: baseHandlers('cleaner', { staff_home_v1: home(), tasks_list_v1: tasksOf([T({})]) }) });
  p = pillOf(one.els['v-home'].innerHTML); assert.equal(textOf(p), '1 task · 1 blocks arrival'); assert.match(p, /<span class="E_cnt">1 to look at<\/span>/); assert.match(p, /E_dot E_bad/); assert.match(p, /data-i="alert"/);
  const many = await boot({ role: 'cleaner', hash: '#home', handlers: baseHandlers('cleaner', { staff_home_v1: home(), tasks_list_v1: tasksOf([T({}), T({ id: 'b', blocks_arrival: false }), T({ id: 'c', blocks_arrival: false })]) }) });
  p = pillOf(many.els['v-home'].innerHTML); assert.equal(textOf(p), '3 tasks · 1 blocks arrival'); assert.equal(aria(p), '3 things to look at. Most urgent: turnover at risk. Opens the list');
  const warn = await boot({ role: 'cleaner', hash: '#home', handlers: baseHandlers('cleaner', { staff_home_v1: home({ warnings: [{ kind: 'inventory', title: 'Low stock: soap', detail: {} }] }), tasks_list_v1: tasksOf([]) }) });
  p = pillOf(warn.els['v-home'].innerHTML); assert.equal(textOf(p), '1 · Low stock'); assert.match(p, /E_dot E_warn/); assert.match(p, /data-i="clock"/);
  const off = await boot({ role: 'cleaner', hash: '#home', handlers: baseHandlers('cleaner', { staff_home_v1: () => ({ error: { message: 'TypeError: Failed to fetch' }, data: null }) }) });
  p = pillOf(off.els['v-home'].innerHTML); assert.equal(textOf(p), 'No connection'); assert.match(p, /E_dot E_idle/); assert.match(p, /data-i="info"/);
});

test('E_ pill: the strip, the warnings line and the Sign out button are gone from Home; the footer says how fresh it is; nothing is said twice', async () => {
  for (const role of ['cleaner', 'admin']) {
    const app = await boot({ role, hash: '#home', handlers: baseHandlers(role, { staff_home_v1: home({ warnings: [{ kind: 'inventory', title: 'Low stock: soap', detail: {} }] }), tasks_list_v1: tasksOf([T({})]) }) });
    const h = app.els['v-home'].innerHTML;
    assert.doesNotMatch(h, /A_strip|class="warnline|aria-label="Status"|Turnover on track|Nothing overdue|No clash days|No warnings today|data-act="signout"|Sign out/, role);
    assert.match(h, /<div class="help F_span" style="text-align:center;margin-top:16px">Updated [^<]*· v3.4.15<\/div>/, role);
  }
  const src = read('app.js'); assert.doesNotMatch(src, /function warnLine|function A_statusStrip/); assert.doesNotMatch(css, /\.A_strip/);
});

test('E_ pill: tapping it opens the "To look at" sheet: groups in order, three rows then See all, real links, focus on the title', async () => {
  const list = [1, 2, 3, 4].map((i) => T({ id: 'r' + i, title: 'Risk ' + i }));
  const app = await boot({ role: 'admin', hash: '#home', fold: FOLD, handlers: baseHandlers('admin', {
    staff_home_v1: home({ warnings: [{ kind: 'brownout', title: 'SOCOTECO II', detail: { date: '2026-10-16', time: '13:00', hours: 3 } }] }),
    tasks_list_v1: tasksOf(list.concat([T({ id: 'o1', title: 'Late one', blocks_arrival: false })]), true), staff_inquiry_payments_v1: () => ({ error: null, data: [{ id: 'b1' }, { id: 'b2' }] }),
    notices_v1: notices('admin', { inbox_open: 2 }) }) });
  await app.click({ 'data-act': 'attn-open' });
  const b = app.els['cs-body'].innerHTML;
  assert.match(b, /<h2 class="ttl" id="cs-h" tabindex="-1">To look at<\/h2>/);
  const caps = [...b.matchAll(/<div class="cap up"[^>]*>([^<]*)</g)].map((m) => m[1]);
  assert.deepEqual(caps, ['Turnover at risk', 'Overdue', 'To confirm', 'Inbox']); // s91: a brownout is Heads-up information on the admin board, not a counted warning
  const risk = b.slice(b.indexOf('Turnover at risk'), b.indexOf('>Overdue<'));
  assert.equal((risk.match(/class="rowi"/g) || []).length, 3, 'three rows'); assert.match(risk, /See all 4/); assert.match(risk, /href="#tasks" data-act="attn-tasks" data-filter="blocks"/);
  assert.match(b, /2 bookings to confirm/); assert.match(b, /2 open messages/); assert.doesNotMatch(b, /Brownout Fri 16 Oct/);
  assert.equal(app.els['cal-sheet'].getAttribute('aria-hidden'), 'false');
  // the row closes the sheet first, sets the filter, and the link goes on to #tasks
  await app.click({ 'data-act': 'attn-tasks', 'data-filter': 'blocks' });
  assert.equal(app.els['cal-sheet'].getAttribute('aria-hidden'), 'true');
});

test('E_ pill: "Bookings to confirm" and the sheet row open the in-app door, never the old stand-alone dashboard URL', async () => {
  const handlers = baseHandlers('admin', { staff_home_v1: home(), tasks_list_v1: tasksOf([], true), staff_inquiry_payments_v1: () => ({ error: null, data: [{ id: 'b1' }] }) });
  const app = await boot({ role: 'admin', hash: '#home', fold: FOLD, handlers });
  const h = app.els['v-home'].innerHTML;
  assert.match(h, /<a class="rowi" href="#door\/dashboard\/bookings\/inquiries"><span class="lead">[^]*?Bookings to confirm/);
  assert.match(h, /aria-hidden="true">1<\/span><span class="sr">1 booking to confirm<\/span>/); assert.doesNotMatch(h, /target="_blank"[^>]*>(?:(?!<\/a>)[^])*Bookings to confirm/);
  await app.click({ 'data-act': 'attn-open' });
  const b = app.els['cs-body'].innerHTML; assert.match(b, /href="#door\/dashboard\/bookings\/inquiries" data-act="sheet-close"/);
  assert.doesNotMatch(h + b, /cascade-admin-dashboard|github\.io/, 'the old dashboard URL appears nowhere in the rendered output');
  // not folded: the dashboard still opens, through its hub URL (the same page, outside the frame), and the row still shows
  const old = await boot({ role: 'admin', hash: '#home', handlers });
  assert.match(old.els['v-home'].innerHTML, /Bookings to confirm/);
});

test('E_ pill: a cleaner\'s sheet has no admin groups even when the payload smuggles them in, and typing the admin routes by hand goes home', async () => {
  const warnings = [{ kind: 'verifier', title: 'Airbnb block runs past the last guest night', severity: 'alert', detail: { check_id: 'V1m' } }, { kind: 'inventory', title: 'Low stock: soap', detail: {} }];
  const app = await boot({ role: 'cleaner', hash: '#home', fold: FOLD, handlers: baseHandlers('cleaner', { staff_home_v1: home({ warnings }), tasks_list_v1: tasksOf([T({})]),
    notices_v1: notices('cleaner', { inbox_open: 9, house: [{ kind: 'finding', id: 'V1m:x', title: 'System check', detail: 'x' }] }), staff_inquiry_payments_v1: () => ({ error: null, data: [{ id: 'b' }] }) }) });
  await app.click({ 'data-act': 'attn-open' });
  const b = app.els['cs-body'].innerHTML;
  assert.match(b, /Turnover at risk/); assert.match(b, /Low stock/);
  assert.doesNotMatch(b, /To confirm|Inbox|Clash|bookings|open messages|System check|Resolve|Tell the guest|#door\/dashboard|Admin|conversations/i);
  assert.equal(app.calls.filter((c) => c[0] === 'staff_inquiry_payments_v1').length, 0, 'a cleaner never even asks for the bookings');
  for (const hash of ['#hub', '#payrates', '#manage', '#door/dashboard/bookings/inquiries', '#door/dashboard']) {
    const x = await boot({ role: 'cleaner', hash, fold: FOLD, handlers: baseHandlers('cleaner', { staff_home_v1: home(), tasks_list_v1: tasksOf([]) }) });
    assert.equal(x.els['door-frame'].getAttribute('data-door'), null, hash + ': no door opened'); assert.equal(x.els['v-hub'].innerHTML, '', hash); assert.equal(x.els['v-payrates'].innerHTML, '', hash);
    assert.match(x.els['v-home'].innerHTML, /E_pill/, hash + ': the cleaner is on her own home');
  }
  const rp = await boot({ role: 'cleaner', hash: '#reply', fold: FOLD, handlers: baseHandlers('cleaner', { staff_home_v1: home(), tasks_list_v1: tasksOf([]) }) });
  assert.match(rp.els['rp-body'].innerHTML, /What did the guest send/, 's82 decision 5: Cassy reply is open to a cleaner too');
});

test('E_ pill: empty, offline and loading sheets say the right thing; the cleaner empty line is her own', async () => {
  const admin = await boot({ role: 'admin', hash: '#home', handlers: baseHandlers('admin', { staff_home_v1: home(), tasks_list_v1: tasksOf([], true), notices_v1: notices('admin', { notices: [], weather: null, inbox_open: 0 }) }) });
  await admin.click({ 'data-act': 'attn-open' });
  assert.match(admin.els['cs-body'].innerHTML, /Nothing to look at<\/h2><p>Tasks, bookings, the inbox and warnings are all clear\./);
  const cl = await boot({ role: 'cleaner', hash: '#home', handlers: baseHandlers('cleaner', { staff_home_v1: home(), tasks_list_v1: tasksOf([]), notices_v1: notices('cleaner', { notices: [], weather: null }) }) });
  await cl.click({ 'data-act': 'attn-open' });
  assert.match(cl.els['cs-body'].innerHTML, /Your tasks and today’s warnings are clear\./);
  const off = await boot({ role: 'cleaner', hash: '#home', handlers: baseHandlers('cleaner', { staff_home_v1: () => ({ error: { message: 'TypeError: Failed to fetch' }, data: null }) }) });
  await off.click({ 'data-act': 'attn-open' });
  assert.match(off.els['cs-body'].innerHTML, /Live information needs a connection\./); assert.match(off.els['cs-body'].innerHTML, /data-act="refresh">Try again/);
  const load = await boot({ role: 'cleaner', hash: '#home', handlers: baseHandlers('cleaner', { staff_home_v1: () => never }) });
  await load.click({ 'data-act': 'attn-open' }); assert.match(load.els['cs-body'].innerHTML, /class="skel"/);
});

test('E_ pill: a refresh the person asked for is read out once (All clear, or N things); the pill itself is not a live region', async () => {
  const app = await boot({ role: 'cleaner', hash: '#home', handlers: baseHandlers('cleaner', { staff_home_v1: home(), tasks_list_v1: tasksOf([T({}), T({ id: 'z', blocks_arrival: false })]) }) });
  assert.equal((app.els['E_attn-live'] || {}).textContent || '', '', 'nothing is announced by loading itself');
  await app.click({ 'data-act': 'refresh' });
  assert.equal(app.els['E_attn-live'].textContent, '2 things to look at');
  assert.doesNotMatch(pillOf(app.els['v-home'].innerHTML), /aria-live|role="status"/);
  assert.match(read('index.html'), /<div class="sr" id="E_attn-live" role="status" aria-live="polite"><\/div>/);
});

test('E_ pill: the hero keeps its place while loading and after (no UI inserted above existing controls once painted): same pill and refresh button in both', async () => {
  const pending = await boot({ role: 'admin', hash: '#home', handlers: baseHandlers('admin', { staff_home_v1: () => never }) });
  const done = await boot({ role: 'admin', hash: '#home', handlers: baseHandlers('admin', { staff_home_v1: home(), tasks_list_v1: tasksOf([], true) }) });
  const shape = (h) => h.slice(h.indexOf('<div class="A_herobar">'), h.indexOf('<div class="A_greet">')).replace(/aria-label="[^"]*"/g, '').replace(/<i class="E_dot [^"]*">/, '<i>').replace(/<span class="E_lbl">[^<]*<\/span><span class="E_cnt">[^<]*<\/span>/, '').replace(/data-i="[a-z]+"/g, '');
  assert.equal(shape(pending.els['v-home'].innerHTML), shape(done.els['v-home'].innerHTML));
});
