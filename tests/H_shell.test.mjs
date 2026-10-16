// Lane H (session 82): the shell changes that are not gestures. App run on the stub DOM with a frozen clock (12:30 Manila on 2026-10-15).
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { CS, D, read, boot, HOMEWITH, baseHandlers, NOTICES_RAW, stayRow, TODAY } from './_a_harness.mjs';

const T = (o) => Object.assign({ source: 'follow_up_tasks', id: 'a', kind: 'reminder', title: 'Water the plants', priority: 'normal', status: 'open', due_at: '2026-10-12T09:00:00Z', mine: true, blocks_arrival: false, detail: null, assignee_label: null, created_at: '2026-10-01T00:00:00Z' }, o);
const tasksOf = (list, manager) => () => ({ error: null, data: { ok: true, manager: !!manager, today: TODAY, tasks: list } });
const mem = () => { const m = new Map(); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const surf = (extra) => Object.assign({ style: {}, offsetWidth: 360, offsetHeight: 400, scrollTop: 0, parentNode: { classList: { add() {}, remove() {}, contains: () => false }, style: {} }, classList: { add() {}, remove() {}, contains: () => false }, getAttribute: () => null, setAttribute() {}, querySelector: () => null, contains(t) { return t === this; }, setPointerCapture() {} }, extra || {});
function drive(app, surface, pts, o) {
  const fire = (t, ev) => { for (const fn of app.listeners[t] || []) fn(ev); };
  const target = { closest: (sel) => (o.pick ? o.pick(sel) : sel === o.sel ? surface : null) };
  pts.forEach((p, i) => { const ev = { clientX: p[1], clientY: p[2], pointerId: 1, timeStamp: p[0], button: 0 }; if (i === 0) fire('pointerdown', Object.assign(ev, { target })); else fire(i === pts.length - 1 ? 'pointerup' : 'pointermove', ev); });
}
const ben = { uid: 'g-ben', guest_name: 'Ben Cruz', source: 'direct', checkin_date: TODAY, checkout_date: '2026-10-18', nights: 3 };
const turnover = (ready) => () => HOMEWITH([stayRow('Ana Reyes', '2026-10-12', TODAY), stayRow('Ben Cruz', TODAY, '2026-10-18')], { next_guest: Object.assign({}, ben, ready ? { arrival_ready: ready } : {}) });

// ------------------------------------------------------------------------------------------------ lib
test('H_ lib: the notice head is kind and day, the sub time and place; a notice link is https only', () => {
  const n = { type: 'power', title: 'Brownout 1:00 to 4:00 pm', date: '2026-10-16', start: '13:00', end: '16:00', source: 'SOCOTECO II', sub: 'x' };
  assert.deepEqual(CS.H_noticeHead(n), { title: 'Brownout · Fri 16 Oct', sub: '1:00 pm to 4:00 pm · SOCOTECO II' });
  assert.equal(CS.H_noticeHead({ type: 'note', title: 'Hello', sub: 's' }).title, 'Hello'); assert.equal(CS.H_noticeHead({ type: 'power', title: 'Brownout later', date: '2026-10-16', sub: 's' }).title, 'Brownout later', 'no time: the title is kept');
  assert.equal(CS.H_noticeUrl('https://www.facebook.com/x/posts/1'), 'https://www.facebook.com/x/posts/1'); for (const bad of ['javascript:alert(1)', 'http://a.b/c', 'https://u:p@a.b/', '', null, 'https://localhost/', 'https://' + 'a'.repeat(600) + '.com']) assert.equal(CS.H_noticeUrl(bad), null, String(bad).slice(0, 20));
  assert.equal(CS.H_weatherShort(29.4, 'Partly cloudy', true), '29° cloudy'); assert.equal(CS.H_weatherShort(29.4, 'Partly cloudy', false), '29° partly cloudy');
});

test('H_ lib: the agenda lists arrivals and departures in the next 14 days, by the day that matters', () => {
  const st = (name, a, b) => ({ guest_name: name, checkin_date: a, checkout_date: b });
  const list = CS.H_agenda([st('Gone', '2026-10-01', '2026-10-10'), st('Here', '2026-10-12', '2026-10-17'), st('Soon', '2026-10-20', '2026-10-22'), st('Far', '2026-11-20', '2026-11-22'), st('Skip', '2026-10-16', '2026-10-18')], TODAY, 14, (s) => s.guest_name === 'Skip');
  assert.deepEqual(list.map((x) => [x.st.guest_name, x.kind, x.day]), [['Here', 'house', '2026-10-17'], ['Soon', 'arrive', '2026-10-20']]);
  assert.equal(CS.H_dayStep('2026-10-15', 1, TODAY), '2026-10-16'); assert.equal(CS.H_dayStep('2026-10-08', -1, TODAY), '2026-10-07'); assert.equal(CS.H_dayStep('2026-10-01', -1, TODAY), '2026-09-30', '3.1.1: back a year'); assert.equal(CS.H_dayStep('2025-10-01', -1, TODAY), null, 'a year back is the edge'); assert.equal(CS.H_dayStep('2026-12-14', 1, TODAY), '2026-12-15'); assert.equal(CS.H_dayStep('2026-12-31', 1, TODAY), null);
});

test('H_ lib: arrival checks are owner and admin only, three states each, and an unknown draws nothing', () => {
  assert.equal(CS.H_ready({ id: true, paid: true, door_code: true }, 'cleaner'), null); assert.equal(CS.H_ready({ id: true }, 'finance'), null); assert.equal(CS.H_ready(null, 'admin'), null); assert.equal(CS.H_ready({ id: null, paid: null, door_code: null }, 'owner'), null);
  const r = CS.H_ready({ id: true, paid: null, door_code: null }, 'admin'); assert.deepEqual(CS.H_readyChips(r).map((c) => c.word), ['ID on file']); assert.equal(CS.H_readyLine(r), 'ID on file'); assert.equal(CS.H_readyOk(r), true);
  const m = CS.H_ready({ id: false, paid: false, door_code: true }, 'owner'); assert.deepEqual(CS.H_readyChips(m).map((c) => c.word), ['No ID yet', 'Balance due', 'Door code set']); assert.equal(CS.H_readyLine(m), 'No ID yet · balance due · door code set'); assert.equal(CS.H_readyOk(m), false);
});

test('H_ lib: cleaning progress is owner and admin only; a finished clean says so; nothing after 15 minutes is amber', () => {
  assert.equal(CS.H_progress({ ok: true, active: { step: 4, of: 9 } }, 'cleaner'), null); assert.equal(CS.H_progress({ ok: false }, 'admin'), null); assert.equal(CS.H_progress(null, 'admin'), null);
  const clock = (iso) => CS.A_turnoverClock(new Date(iso), null);
  const act = CS.H_progress({ ok: true, active: { step: 4, of: 9, label: 'x', cleaner_name: 'Honey Cruz', updated_at: '2026-10-15T04:48:00Z' } }, 'admin');
  assert.deepEqual(CS.H_cleanLine(act, clock('2026-10-15T04:50:00Z')), { tone: 'ok', text: 'Honey · step 4 of 9 · 12:48' });
  const done = CS.H_progress({ ok: true, active: { step: 9, of: 9, updated_at: '2026-10-15T05:42:00Z' } }, 'admin'); assert.deepEqual(CS.H_cleanLine(done, clock('2026-10-15T05:50:00Z')), { tone: 'ok', text: 'Clean finished 1:42 pm' });
  const none = CS.H_progress({ ok: true, active: null }, 'owner');
  assert.equal(CS.H_cleanLine(none, clock('2026-10-15T03:50:00Z')).tone, 'idle'); assert.equal(CS.H_cleanLine(none, clock('2026-10-15T04:10:00Z')).tone, 'idle', '10 minutes in'); assert.equal(CS.H_cleanLine(none, clock('2026-10-15T04:20:00Z')).tone, 'warn', '20 minutes in'); assert.equal(CS.H_cleanLine(null, clock('2026-10-15T04:20:00Z')), null, 'no RPC: no row');
  assert.deepEqual(CS.H_houseLine({ list: [{ type: 'power', date: TODAY, start: '13:00', end: '16:00', key: 'n:1' }] }, TODAY), { tone: 'warn', text: 'Brownout 1:00 pm to 4:00 pm' }); assert.deepEqual(CS.H_houseLine({ list: [] }, TODAY), { tone: 'ok', text: 'Clear' });
  assert.equal(CS.H_untilLine(clock('2026-10-15T04:20:00Z'), true), '1 h 40 min until check-in'); assert.equal(CS.H_untilLine(clock('2026-10-15T03:00:00Z'), true), 'Clean from noon'); assert.equal(CS.H_untilLine(clock('2026-10-15T06:30:00Z'), true), 'Checked in');
});

test('H_ lib: search hands a cleaner no guest; the manual index is read tolerantly', () => {
  const src = { tasks: [T({ title: 'Fix the aircon' }), T({ id: 'd', title: 'Aircon done', status: 'done' })], stays: [{ guest_name: 'Ana Reyes' }], manual: CS.H_manualIndex({ entries: [{ title: 'Aircon does not cool', id: 'aircon' }, { title: 'bad', id: 'a b' }, { heading: 'Hot water', anchor: 'heater' }] }) };
  assert.deepEqual(src.manual, [{ title: 'Aircon does not cool', id: 'aircon' }, { title: 'Hot water', id: 'heater' }]);
  const o = CS.H_search('aircon', src, 'owner'); assert.equal(o.tasks.length, 1); assert.equal(o.manual.length, 1); assert.equal(CS.H_search('ana', src, 'owner').guests.length, 1);
  for (const role of ['cleaner', 'finance', 'inspector', 'maintenance']) assert.deepEqual(CS.H_search('ana', src, role).guests, [], role + ' never gets a guest');
  assert.deepEqual(CS.H_search('a', src, 'owner'), { tasks: [], guests: [], manual: [] }, 'one letter is not a search');
  assert.equal(CS.H_manualIndex(null).length, 0);
});

test('H_ lib: arrival_ready.paid passes the money guard only as a yes, no or unknown, only for owner and admin', () => {
  const ok = { next_guest: { arrival_ready: { id: true, paid: false, door_code: null } } };
  assert.equal(CS.assertNoMoney(ok, { allowContact: true }), true); assert.throws(() => CS.assertNoMoney(ok), /paid/, 'a cleaner payload carrying it is blocked');
  assert.throws(() => CS.assertNoMoney({ next_guest: { arrival_ready: { paid: '5,000' } } }, { allowContact: true })); assert.throws(() => CS.assertNoMoney({ paid_amount: 5 }, { allowContact: true })); assert.throws(() => CS.assertNoMoney({ other: { paid: true } }, { allowContact: true }));
});

// ------------------------------------------------------------------------------------------------ the one calendar screen
test('H_ calendar: Calendar | Notices only; a Stays link lands on the one screen; the agenda, help line and legend are there', async () => {
  const cal = [stayRow('Ana Reyes', '2026-10-14', '2026-10-17'), stayRow('Zed Cruz', '2026-10-20', '2026-10-22')];
  const app = await boot({ role: 'admin', hash: '#calendar/stays', handlers: baseHandlers('admin', { staff_home_v1: () => HOMEWITH(cal) }) });
  assert.equal(app.location.hash, '#calendar', 'the old Stays address redirects'); const h = app.els['v-calendar'].innerHTML;
  assert.doesNotMatch(h, />Stays<\/a>|>Month<\/a>/); assert.match(h, /Next 14 days/); assert.match(h, /Tap a day for who is staying\. Swipe for the next month\./);
  assert.match(h, /Leaves Sat 17 Oct/); assert.match(h, /Arrives Tue 20 Oct/); assert.match(h, /id="warnings"/);
  assert.match(h, /<button class="H_more" type="button" data-act="legend-more" aria-expanded="false"/);
  const info = CS.H_agenda(CS.mergeStays(cal), TODAY, 14); assert.equal(info.length, 2);
});

test('H_ calendar: More in the legend opens the rest and is remembered', async () => {
  const ls = mem(); const app = await boot({ role: 'admin', hash: '#calendar', ls, handlers: baseHandlers('admin') });
  await app.click({ 'data-act': 'legend-more' }); assert.equal(ls.getItem('cs_legend_open'), '1'); await app.click({ 'data-act': 'legend-more' }); assert.equal(ls.getItem('cs_legend_open'), '0');
  ls.setItem('cs_legend_open', '1'); const again = await boot({ role: 'admin', hash: '#calendar', ls, handlers: baseHandlers('admin') });
  assert.match(again.els['v-calendar'].innerHTML, /data-open="1"/);
});

test('H_ calendar: arrival chips show for owner and admin only when the field exists, and an unknown draws nothing; a cleaner payload that carries them is blocked', async () => {
  const cal = [stayRow('Ana Reyes', '2026-10-12', '2026-10-17'), stayRow('Ben Cruz', '2026-10-20', '2026-10-22')];
  const next = { uid: 'g2', guest_name: 'Ben Cruz', source: 'direct', checkin_date: '2026-10-20', checkout_date: '2026-10-22', nights: 2 };
  const withReady = (r) => () => HOMEWITH(cal.map((c) => (c.guest_name === 'Ben Cruz' ? Object.assign({}, c, { arrival_ready: r }) : c)), { next_guest: Object.assign({}, next, { arrival_ready: r }) });
  const a = await boot({ role: 'admin', hash: '#calendar', handlers: baseHandlers('admin', { staff_home_v1: withReady({ id: false, paid: null, door_code: null }) }) });
  assert.match(a.els['v-calendar'].innerHTML, /No ID yet/); assert.doesNotMatch(a.els['v-calendar'].innerHTML, /Balance|Door code/, 'unknown draws nothing'); assert.match(a.els['v-calendar'].innerHTML, /Add ID photo/);
  const none = await boot({ role: 'admin', hash: '#calendar', handlers: baseHandlers('admin', { staff_home_v1: () => HOMEWITH(cal, { next_guest: next }) }) }); assert.doesNotMatch(none.els['v-calendar'].innerHTML, /ID on file|No ID yet/, 'no field, no chips');
  const c = await boot({ role: 'cleaner', hash: '#home', handlers: baseHandlers('cleaner', { staff_home_v1: withReady({ id: true, paid: true, door_code: true }) }) });
  assert.match(c.els['v-home'].innerHTML, /blocked because the data carried an amount/); assert.doesNotMatch(c.els['v-home'].innerHTML, /ID on file/);
});

test('H_ calendar: the day sheet has previous and next day arrows, they move one day, and the swipe does the same', async () => {
  const app = await boot({ role: 'admin', hash: '#calendar', handlers: baseHandlers('admin') });
  await app.click({ 'data-day': '2026-10-16' }); const title = () => (/<h2 class="ttl"[^>]*>([^<]+)</.exec(app.els['cs-body'].innerHTML) || [])[1];
  assert.equal(title(), 'Friday 16 October'); assert.match(app.els['cs-body'].innerHTML, /data-act="day-prev"/);
  await app.click({ 'data-act': 'day-next' }); assert.equal(title(), 'Saturday 17 October'); await app.click({ 'data-act': 'day-prev' }); await app.click({ 'data-act': 'day-prev' }); assert.equal(title(), 'Thursday 15 October');
  const sh = app.els['cal-sheet']; drive(app, sh, [[0, 300, 300], [100, 250, 302], [200, 200, 302], [600, 200, 302]], { pick: (s) => (s === '#cal-sheet' ? sh : null) });
  assert.equal(title(), 'Friday 16 October', 'a swipe left is the next day');
  drive(app, sh, [[0, 100, 300], [100, 150, 302], [200, 200, 302], [600, 200, 302]], { pick: (s) => (s === '#cal-sheet' ? sh : null) }); assert.equal(title(), 'Thursday 15 October', 'right is the day before');
});

test('H_ calendar: the day sheet keeps a note being typed (no day change); a notice carries its original link in a new tab', async () => {
  const app = await boot({ role: 'admin', hash: '#calendar', handlers: baseHandlers('admin') }); await app.click({ 'data-day': '2026-10-16' }); await app.click({ 'data-act': 'dayform-open' }); app.input('df-label', 'Plumber'); await app.click({ 'data-act': 'day-next' });
  assert.match(app.els['cs-body'].innerHTML, /Friday 16 October/); assert.match(app.els['cs-body'].innerHTML, /before moving to another one/);
  const raw = NOTICES_RAW({ notices: [{ id: 'n1', type: 'power', title: 'Brownout 1:00 to 4:00 pm', date: '2026-10-16', start_time: '13:00', end_time: '16:00', source: 'socoteco', detail: null, url: 'https://www.facebook.com/x/posts/1' }, { id: 'n2', type: 'water', title: 'No water', date: '2026-10-20', start_time: null, end_time: null, source: 'gscwd', detail: null, url: 'javascript:alert(1)' }] });
  const n = await boot({ role: 'admin', hash: '#calendar/notices', handlers: baseHandlers('admin', { notices_v1: () => ({ error: null, data: raw }) }) }); const h = n.els['v-calendar'].innerHTML;
  assert.equal((h.match(/Open the original notice/g) || []).length, 1); assert.match(h, /href="https:\/\/www\.facebook\.com\/x\/posts\/1" target="_blank" rel="noopener noreferrer"/); assert.doesNotMatch(h, /javascript:/);
  assert.match(h, /class="btn btn-secondary btn-block H_addnotice"[^>]*data-act="notice-add-open"/, 'F5: Add a notice under the filter chips'); assert.match(h, /href="#weather"/, 'the weather card opens #weather');
  const c = await boot({ role: 'cleaner', hash: '#calendar/notices', handlers: baseHandlers('cleaner') }); assert.doesNotMatch(c.els['v-calendar'].innerHTML, /H_addnotice/);
});

// ------------------------------------------------------------------------------------------------ hints, Home, More
test('H_ hints: the first Tasks visit peeks the first row 32 px (once, never after a swipe worked), and says how to swipe', async () => {
  const row = surf(); const q = (s) => (/taskrow/.test(s) ? row : null);
  const app = await boot({ role: 'admin', hash: '#tasks', docQuery: q, handlers: baseHandlers('admin', { tasks_list_v1: tasksOf([T({})], true) }) });
  assert.equal(row.style.transform, 'translateX(-32px)'); assert.match(app.els['v-tasks'].innerHTML, /Swipe a task left to mark it done\./);
  const row2 = surf(); const ls = mem(); ls.setItem('cs_swiped', '1');
  await boot({ role: 'admin', hash: '#tasks', ls, docQuery: (s) => (/taskrow/.test(s) ? row2 : null), handlers: baseHandlers('admin', { tasks_list_v1: tasksOf([T({})], true) }) }); assert.equal(row2.style.transform, undefined, 'a swipe has worked on this phone: no peek');
  const w = surf(), lsw = mem(); const app2 = await boot({ role: 'admin', hash: '#tasks', ls: lsw, docQuery: () => null, handlers: baseHandlers('admin', { tasks_list_v1: tasksOf([T({})], true), task_set_done_v1: () => ({ error: null, data: { ok: true } }) }) });
  drive(app2, surf({ getAttribute: (k) => ({ 'data-task': 'follow_up_tasks:a', 'data-E-swipe': 'task-done', 'data-E-w': '96' })[k] ?? null }), [[0, 330, 200], [60, 280, 201], [120, 200, 201], [500, 200, 201]], { sel: '.taskrow[data-E-swipe]' });
  assert.equal(lsw.getItem('cs_swiped'), '1'); assert.ok(w);
});

test('H_ tasks: Show done is a 44 px button; a tap offline sends nothing and says so under the row; the strip says the screen is the last one', async () => {
  const app = await boot({ role: 'admin', hash: '#tasks', nav: { onLine: false }, handlers: baseHandlers('admin', { tasks_list_v1: tasksOf([T({})], true), task_set_done_v1: () => ({ error: null, data: { ok: true } }) }) });
  assert.match(app.els['v-tasks'].innerHTML, /data-act="tasks-toggle-done"[^>]*>Show done \(14 days\)<\/button>/);
  await app.click({ 'data-act': 'task-done', 'data-task': 'follow_up_tasks:a' });
  assert.equal(app.calls.filter((c) => c[0] === 'task_set_done_v1').length, 0, 'no queue: nothing was sent'); assert.match(app.els['v-tasks'].innerHTML, /<span class="s c-danger H_noconn" role="status">No connection<\/span>/);
  assert.match(app.els['H_offline'].textContent, /^No connection/); assert.equal(app.els['H_offline'].hidden, false);
  const on = await boot({ role: 'admin', hash: '#tasks', handlers: baseHandlers('admin', { tasks_list_v1: tasksOf([T({})], true) }) }); assert.equal(on.els['H_offline'].hidden, true);
});

test('H_ home: pay links carry the badge counts in their hash, the cleaner home says Cleaning fee, has the manual, Inventory and Cassy reply', async () => {
  const c = await boot({ role: 'cleaner', hash: '#home', handlers: baseHandlers('cleaner', { tasks_list_v1: tasksOf([T({})]) }) }); const h = c.els['v-home'].innerHTML;
  assert.match(h, /href="\.\/pay\/#tasks=1&amp;cal=0"/); assert.match(h, /Cleaning fee/); assert.match(h, /Ask for payment for your cleans and expenses/); assert.doesNotMatch(h, /Ask for your pay/);
  assert.match(h, /House manual/); assert.match(h, /href="#stock"/); assert.match(h, /Cassy reply/);
  const a = await boot({ role: 'owner', hash: '#home', handlers: baseHandlers('owner') }); const ah = a.els['v-home'].innerHTML;
  assert.match(ah, /href="\.\/pay\/admin\.html#tasks=0&amp;cal=0"/); assert.match(ah, /href="#manage"/); assert.match(ah, /Inquiries, expenses and key figures/); assert.match(ah, /href="#manage\/kpis"/); assert.match(ah, /href="#stock"/);
  const f = await boot({ role: 'finance', hash: '#home', handlers: baseHandlers('finance') }); assert.doesNotMatch(f.els['v-home'].innerHTML, /href="#manage"/, 'manage is owner and admin');
  assert.match(a.els['tabbar'].innerHTML, /Today/); assert.doesNotMatch(a.els['tabbar'].innerHTML, />Home</);
});

test('H_ home: the admin Turnover card is a verdict (clean, arrival, house); rows with no data are not drawn; a cleaner gets the staff card', async () => {
  const handlers = (ready, prog) => baseHandlers('admin', { staff_home_v1: turnover(ready), cleaning_progress_v1: prog || (() => ({ error: { code: 'PGRST202', message: 'x' }, data: null })) });
  const a = await boot({ role: 'admin', hash: '#home', handlers: handlers({ id: true, paid: false, door_code: null }, () => ({ error: null, data: { ok: true, active: { step: 4, of: 9, cleaner_name: 'Honey Cruz', updated_at: '2026-10-15T04:20:00Z' } } })) });
  const h = a.els['v-home'].innerHTML; assert.match(h, /Today · out 12:00 noon · in 2:00 pm/); assert.match(h, /<span class="k">Clean<\/span><b>Honey · step 4 of 9 · 12:20<\/b>/); assert.match(h, /<span class="k">Arrival<\/span><b>ID on file · balance due<\/b>/); assert.match(h, /<span class="k">House<\/span><b>Clear<\/b>/);
  assert.match(h, /Open booking|Set the door code/, 'a missing item has its action'); assert.equal(a.calls.filter((c) => c[0] === 'cleaning_progress_v1').length, 1);
  const none = await boot({ role: 'admin', hash: '#home', handlers: handlers(null) }); const nh = none.els['v-home'].innerHTML;
  assert.doesNotMatch(nh, /<span class="k">Clean<\/span>/, 'the RPC is absent: no Clean row'); assert.doesNotMatch(nh, /<span class="k">Arrival<\/span>/, 'the field is absent: no Arrival row'); assert.match(nh, /<span class="k">House<\/span>/);
  const c = await boot({ role: 'cleaner', hash: '#home', handlers: baseHandlers('cleaner', { staff_home_v1: turnover(null) }) }); const ch = c.els['v-home'].innerHTML;
  assert.match(ch, /Guest out 12:00 noon · Ben Cruz in 2:00 pm/); assert.match(ch, /1 h 30 min until check-in/); assert.doesNotMatch(ch, /class="k">Clean</); assert.equal(c.calls.filter((x) => x[0] === 'cleaning_progress_v1').length, 0, 'a cleaner never asks');
});

test('H_ More: the manual, Appearance, Cassy, This phone, then Sign out last as a quiet button; search and the tour are rows', async () => {
  const m = await boot({ role: 'admin', hash: '#more', handlers: baseHandlers('admin') }); const h = m.els['v-more'].innerHTML; const at = (s) => h.indexOf(s);
  assert.ok(at('How we do things') < at('Cassy reply') && at('Cassy reply') < at('Appearance') && at('Appearance') < at('This phone') && at('This phone') < at('data-act="signout"'));
  assert.match(h, /btn btn-ghost E_signout/); assert.match(h, /href="#search"/); assert.match(h, /data-act="tour-open"/); assert.equal((h.match(/data-act="signout"/g) || []).length, 1);
});

// ------------------------------------------------------------------------------------------------ MF1, MF4, MF5
const FOLD = { schema: 1, surfaces: { admin: { files: 84 }, checklist: { files: 8 }, manual: { files: 16 }, guide: { files: 48, adminGuide: true } } };
const frameEl = () => { const w = { location: { replace() {} } }, a = {}; return { w, el: { contentWindow: w, style: {}, title: '', setAttribute(k, v) { a[k] = v; }, getAttribute: (k) => (k in a ? a[k] : null), removeAttribute(k) { delete a[k]; } } }; };
async function openDoor(role, hash) {
  const f = frameEl(); const app = await boot({ role, hash: '#home', fold: FOLD, els: { 'door-frame': f.el }, handlers: baseHandlers(role, { staff_home_v1: turnover(null) }) });
  app.location.hash = hash || '#door/checklist'; for (const fn of app.winListeners.hashchange || []) fn(); await app.flush(); return { app, f };
}
const say = async (x, data, origin, source) => { for (const fn of x.app.winListeners.message || []) fn({ origin: origin || 'https://staff.example', data, source: source === undefined ? x.f.w : source }); await x.app.flush(); };
test('H_ clean done: only the open checklist frame of a staff session can say it; Home then shows the card with the shared pay link', async () => {
  const x = await openDoor('cleaner'), app = x.app;
  const good = { type: 'cs-clean-done', session_id: 's-1', started_at: '2026-10-15T03:00:00Z', finished_at: '2026-10-15T04:25:00Z', issues: 2, photos: 6 };
  await say(x, good, 'https://evil.example'); assert.notEqual(app.location.hash, '#home', 'another origin is ignored');
  await say(x, good, undefined, {}); assert.notEqual(app.location.hash, '#home', 'a window that is not the door frame is ignored');
  await say(x, { type: 'other' }); assert.notEqual(app.location.hash, '#home');
  await say(x, good);
  const h = app.els['v-home'].innerHTML; assert.equal(app.location.hash, '#home'); assert.match(h, /Clean done · 1 h 25 min/); assert.match(h, /Ben Cruz in at 2:00 pm/); assert.match(h, /2 issues logged · 6 photos/);
  assert.match(h, /href="\.\/pay\/\?clean=s-1#tasks=0&amp;cal=0"[^>]*>Ask for the cleaning fee/); await app.click({ 'data-act': 'clean-done-hide' }); assert.doesNotMatch(app.els['v-home'].innerHTML, /Clean done/);
  const y = await openDoor('cleaner'); await say(y, { type: 'cs-clean-done', session_id: '../x y', issues: -3, photos: 'many' });
  assert.match(y.app.els['v-home'].innerHTML, /No issues logged · 0 photos/); assert.doesNotMatch(y.app.els['v-home'].innerHTML, /\?clean=/, 'a bad id is dropped');
  const adm = await openDoor('admin', '#door/dashboard'); await say(adm, good); assert.doesNotMatch(adm.app.els['v-home'].innerHTML, /Clean done/, 'not from another door');
  const ad2 = await openDoor('admin'); await say(ad2, good); assert.doesNotMatch(ad2.app.els['v-home'].innerHTML, /Clean done/, 'the card is for the role that asks for the fee');
  assert.match(read('index.html'), /id="door-done"/); assert.match(read('app.js'), /'Cleaning · '/); assert.match(read('app.js'), /return LINKS\.pay \+ \(page/);
});

test('H_ tour: three cards once, Skip at any time, never again on this phone; More plays it on demand; the demo does not start it', async () => {
  const ls = mem(); const app = await boot({ role: 'cleaner', hash: '#home', tour: true, tourDelay: 0, ls, handlers: baseHandlers('cleaner') }); await app.flush(); await new Promise((r) => setTimeout(r, 20));
  assert.equal(app.els['cal-sheet'].getAttribute('aria-hidden'), 'false'); assert.match(app.els['cs-body'].innerHTML, /Today shows who is here and what is next\./); assert.equal(ls.getItem('cs_seen_v3'), '1');
  await app.click({ 'data-act': 'tour-next' }); assert.match(app.els['cs-body'].innerHTML, /Swipe the grid left or right for the next month/); await app.click({ 'data-act': 'tour-next' }); assert.match(app.els['cs-body'].innerHTML, /Your cleaning fee is under Work on Today\./); assert.match(app.els['cs-body'].innerHTML, /3 of 3/);
  await app.click({ 'data-act': 'tour-next' }); assert.equal(app.els['cal-sheet'].getAttribute('aria-hidden'), 'true');
  const again = await boot({ role: 'cleaner', hash: '#home', tour: true, tourDelay: 0, ls, handlers: baseHandlers('cleaner') }); await new Promise((r) => setTimeout(r, 20)); assert.ok(!again.els['cal-sheet'] || again.els['cal-sheet'].getAttribute('aria-hidden') !== 'false', 'seen once: never again');
  const more = await boot({ role: 'admin', hash: '#more', handlers: baseHandlers('admin') }); await more.click({ 'data-act': 'tour-open' }); await more.click({ 'data-act': 'tour-next' }); await more.click({ 'data-act': 'tour-next' }); assert.match(more.els['cs-body'].innerHTML, /Pay staff is under Admin/); await more.click({ 'data-act': 'tour-skip' }); assert.equal(more.els['cal-sheet'].getAttribute('aria-hidden'), 'true');
  const demo = await boot({ role: 'owner', hash: '#home', demo: true, tour: true, tourDelay: 0, handlers: baseHandlers('owner') }); await new Promise((r) => setTimeout(r, 20)); assert.ok(!demo.els['cal-sheet'] || demo.els['cal-sheet'].getAttribute('aria-hidden') !== 'false');
});

test('H_ search: tasks and the manual for staff, guests too for owner and admin, a cleaner is never shown a guest', async () => {
  const cal = [stayRow('Ana Reyes', '2026-10-14', '2026-10-17')]; const manual = { ok: true, json: () => Promise.resolve([{ title: 'Aircon does not cool', id: 'aircon' }]) };
  const run = async (role) => {
    const app = await boot({ role, hash: '#search', foldFetch: (u) => Promise.resolve(/manual\/index\.json/.test(String(u)) ? manual : { ok: false }), handlers: baseHandlers(role, { staff_home_v1: () => HOMEWITH(cal), tasks_list_v1: tasksOf([T({ title: 'Aircon filter' })], role !== 'cleaner') }) });
    app.winListeners; await app.flush(); app.input('sr-q', 'a'); app.input('sr-q', 'ana'); const guests = app.els['sr-res'].innerHTML; app.input('sr-q', 'aircon'); return { guests, aircon: app.els['sr-res'].innerHTML, label: app.els['v-search'].innerHTML };
  };
  const o = await run('owner'); assert.match(o.guests, /Ana Reyes/); assert.match(o.aircon, /Aircon filter/); assert.match(o.aircon, /href="#door\/manual\/aircon"/); assert.match(o.label, /Find a task, a guest or a manual page/);
  const c = await run('cleaner'); assert.doesNotMatch(c.guests, /Ana Reyes|Guests/); assert.match(c.aircon, /Aircon filter/); assert.match(c.aircon, /Aircon does not cool/); assert.doesNotMatch(c.label, /guest/);
});

// ------------------------------------------------------------------------------------------------ the module loader
test('H_ modules: the table is exactly the contract, the role gate runs before anything loads, sub is everything after the first slash', async () => {
  const src = read('app.js'), flat = src.replace(/\s+/g, ' ');
  for (const line of ["weather: { src: 'weather/W_weather.js', css: 'weather/W_weather.css', global: 'W_Weather', title: 'Weather', roles: null }", "stock: { src: 'stock/I_stock.js', css: 'stock/I_stock.css', global: 'I_Stock', title: 'Inventory', roles: ['owner', 'admin', 'cleaner', 'finance'] }", "manage: { src: 'manage/N_manage.js', css: 'manage/N_manage.css', global: 'N_Manage', title: 'Manage', roles: ['owner', 'admin'],"]) assert.ok(flat.includes(line), line);
  const loaded = [], mounts = [], unmounts = [];
  const winInit = (win) => { win.H_loadAsset = (m) => { loaded.push(m.src); win[m.global] = { mount(el, o) { mounts.push(Object.assign({ el }, o)); }, unmount() { unmounts.push(m.global); } }; return Promise.resolve(); }; };
  const s = await boot({ role: 'cleaner', hash: '#stock/item/42', winInit, handlers: baseHandlers('cleaner') });
  assert.deepEqual(loaded, ['stock/I_stock.js']); assert.equal(mounts.length, 1); const o = mounts[0];
  assert.equal(o.sub, 'item/42'); assert.equal(o.role, 'cleaner'); assert.equal(o.demo, false); assert.equal(o.propertyId, 'prop-1'); assert.equal(o.houseTimes.outLabel, '12:00 noon'); assert.ok(o.client && typeof o.client.rpc === 'function');
  for (const k of ['navigate', 'toast', 'haptic']) assert.equal(typeof o[k], 'function', k); o.navigate('#door/dashboard/bookings'); assert.equal(s.location.hash, '#door/dashboard/bookings');
  assert.match(s.els['v-stock'].innerHTML, /<h1 class="ttl">Inventory<\/h1>/); assert.match(s.els['v-stock'].innerHTML, /href="#home" aria-label="Back"/);
  s.location.hash = '#home'; for (const f of s.winListeners.hashchange || []) f(); await s.flush(); assert.deepEqual(unmounts, ['I_Stock'], 'leaving unmounts it');
  const l2 = [], m2 = []; const none = await boot({ role: 'cleaner', hash: '#manage', winInit: (w) => { w.H_loadAsset = (m) => { l2.push(m.src); return Promise.resolve(); }; }, handlers: baseHandlers('cleaner', {}) });
  assert.deepEqual(l2, [], 'a role outside roles never loads the script'); assert.equal(none.els['v-manage'].innerHTML, ''); assert.match(none.els['v-home'].innerHTML, /A_hero/, 'she is on her own home');
  const fin = await boot({ role: 'finance', hash: '#manage/kpis', winInit: (w) => { w.H_loadAsset = (m) => { l2.push(m.src); return Promise.resolve(); }; }, handlers: baseHandlers('finance') }); assert.deepEqual(l2, []); assert.equal(fin.els['v-manage'].innerHTML, ''); assert.ok(m2);
  const w = await boot({ role: 'cleaner', hash: '#weather', winInit: (win) => { win.H_loadAsset = (m) => { loaded.push(m.src); win[m.global] = { mount(el, o) { mounts.push(o); } }; return Promise.resolve(); }; }, handlers: baseHandlers('cleaner') }); assert.equal(w.location.hash, '#weather'); assert.equal(mounts.at(-1).sub, '', 'weather has no sub');
});

test('H_ modules: with the folder absent each route falls back (weather to Notices, stock to the inventory door, manage to the admin hub); a module is signed out with the session', async () => {
  const fail = (win) => { win.H_loadAsset = () => Promise.reject(new Error('404')); };
  const w = await boot({ role: 'cleaner', hash: '#weather', winInit: fail, handlers: baseHandlers('cleaner') }); assert.equal(w.location.hash, '#calendar/notices');
  const FOLD = { schema: 1, surfaces: { admin: { files: 84 }, checklist: { files: 8 }, manual: { files: 16 }, guide: { files: 48, adminGuide: true } } };
  const s = await boot({ role: 'admin', hash: '#stock', winInit: fail, fold: FOLD, handlers: baseHandlers('admin') }); assert.equal(s.location.hash, '#door/inventory');
  const cs = await boot({ role: 'cleaner', hash: '#stock', winInit: fail, handlers: baseHandlers('cleaner') }); assert.equal(cs.location.hash, '#home', 'no inventory door for a cleaner');
  const m = await boot({ role: 'owner', hash: '#manage/money', winInit: fail, handlers: baseHandlers('owner') }); assert.equal(m.location.hash, '#hub');
  const unm = []; const so = await boot({ role: 'admin', hash: '#manage', winInit: (win) => { win.H_loadAsset = (mm) => { win[mm.global] = { mount() {}, unmount() { unm.push(1); } }; return Promise.resolve(); }; }, handlers: baseHandlers('admin') });
  await so.click({ 'data-act': 'signout' }); assert.deepEqual(unm, [1], 'sign-out unmounts it before the session goes');
  assert.match(read('app.js'), /payrates/); assert.match(read('app.js'), /v === 'payrates' && !CS\.canEditRates/, '#payrates stays a top-level shell route');
});

test('H_ reply: options draw as selectable draft cards each with its own Copy; the single draft still works; every role reaches the screen; Messenger inbox after a copy', async () => {
  const draft = (extra) => async () => ({ ok: true, status: 200, json: () => Promise.resolve(Object.assign({ ok: true, guest_name: 'Ana', platform: 'messenger', guest_text: 'Early check-in?', header: 'The last message in the screenshot is yours; this answers the guest’s last message.' }, extra)) });
  const run = async (role, extra) => {
    let f = draft(extra); const app = await boot({ role, hash: '#reply', winInit: () => {}, handlers: baseHandlers(role), foldFetch: undefined });
    return app;
  };
  const app = await run('cleaner'); assert.match(app.els['rp-body'].innerHTML, /What did the guest send/); assert.match(app.els['rp-body'].innerHTML, /How it goes/);
  // render the result screen through the real result parser
  const X = CS.replyResult({ ok: true, header: 'h', options: [{ label: 'Short', text: 'A' }, { label: 'Warm', text: 'B' }, { label: 'With details', text: 'C' }] });
  assert.deepEqual(X.options.map((o) => o.label), ['Short', 'Warm', 'With details']); assert.equal(X.options.length, 3);
  const src = read('app.js'); assert.match(src, /data-act="reply-copy" data-i="' \+ i \+ '"/); assert.match(src, /X\.header \? '<p class="sub"/); assert.match(src, /Open Messenger inbox/); assert.match(src, /state\.replyRecent/);
  assert.ok(draft);
});

test('H_ ID photo: owner and admin get a full-screen tap on the picture; the code is guarded by role and never downloads', () => {
  const src = read('app.js'); assert.match(src, /if \(CS\.canSeeGuestContact\(role\(\)\)\) \{ var b = document\.createElement\('button'\)/); assert.match(src, /a === 'id-full'\) \{ var im = [^}]*CS\.canSeeGuestContact\(role\(\)\)\) H_idFull/);
  assert.doesNotMatch(src.slice(src.indexOf('function H_idFull'), src.indexOf('function H_idClose')), /download|href=/);
});

test('H_ attention: a task row has a tick box, a system check says Mark as handled, the count falls as she works', async () => {
  const gone = new Set(); const handlers = baseHandlers('admin', { tasks_list_v1: () => tasksOf([T({ blocks_arrival: true }), T({ source: 'verifier_findings', id: 'V1:x', kind: 'verifier', title: 'Check', due_at: null })].filter((t) => !gone.has(t.id)), true)(), task_set_done_v1: (a) => { gone.add(a.p_id); return { error: null, data: { ok: true } }; }, ack_verifier_finding_v1: () => ({ error: null, data: { ok: true } }) });
  const app = await boot({ role: 'admin', hash: '#home', handlers }); await app.click({ 'data-act': 'attn-open' });
  const b = app.els['cs-body'].innerHTML; assert.match(b, /class="chk H_chk" type="button" role="checkbox"[^>]*data-act="task-done" data-task="follow_up_tasks:a"/);
  await app.click({ 'data-act': 'task-done', 'data-task': 'follow_up_tasks:a' }); assert.equal(app.calls.filter((c) => c[0] === 'task_set_done_v1').length, 1);
  assert.doesNotMatch(app.els['cs-body'].innerHTML, /data-task="follow_up_tasks:a"/, 'the sheet redraws without it');
});

// ------------------------------------------------------------------------------------------------ guards
test('H_ guard: no duplicate top-level H_ names in app.js or lib.js, the files parse, the new view ids are in index.html', () => {
  for (const f of ['app.js', 'lib.js']) {
    const src = read(f), names = [...src.matchAll(/(?:function|var) (H_\w+)/g)].map((m) => m[1]); const dup = names.filter((n, i) => names.indexOf(n) !== i);
    assert.deepEqual(dup, [], f + ' repeats ' + dup.join(', ')); assert.doesNotThrow(() => new vm.Script(src, { filename: f }));
  }
  const html = read('index.html'); for (const id of ['v-search', 'v-weather', 'v-stock', 'v-manage', 'H_offline', 'door-done']) assert.ok(html.includes('id="' + id + '"'), id);
  assert.match(html, /Your name, as Lloyd wrote it/); assert.match(html, /placeholder="Honey"/);
  assert.equal(JSON.parse(read('package.json')).version, '3.4.3'); assert.match(read('sw.js'), /CACHE_NAME = 'cs-shell-v28'/);
});

// the bodies of the three theme rules: :root, :root:not([data-theme="light"]) inside the dark media query, :root[data-theme="dark"]
function ruleBodies(css) {
  const c = css.replace(/\/\*[\s\S]*?\*\//g, ''), out = []; let i = 0;
  while (i < c.length) {
    const open = c.indexOf('{', i); if (open < 0) break; const head = c.slice(i, open).trim(); let depth = 1, j = open + 1; while (j < c.length && depth) { depth += c[j] === '{' ? 1 : c[j] === '}' ? -1 : 0; j++; }
    const inner = c.slice(open + 1, j - 1);
    if (/^@media/.test(head)) { for (const r of ruleBodies(inner)) out.push(r); } else if (/^:root(:not\(\[data-theme="light"\]\)|\[data-theme="dark"\])?$/.test(head)) out.push(inner);
    i = j;
  }
  return out;
}
test('H_ look: the 13 px floor is in the tokens, the sheet header is the pull surface, the legend is one row, the hero is a third at most, light gold is darker', () => {
  const tk = read('tokens.css'), css = read('styles.css');
  assert.match(tk, /--v5-t-label: clamp\(0\.8125rem,/); assert.match(tk, /--v5-t-min: clamp\(0\.8125rem, 0\.716rem \+ 0\.151vw, 0\.8125rem\);/); assert.match(tk, /--v5-t-chrome: clamp\(13px,/); assert.match(tk, /--v5-gold-text: #7A4E0E;/);
  const bodies = ruleBodies(tk); assert.equal(bodies.length, 3, 'light, OS dark, forced dark');
  for (const n of ['field-line', 'gold-wash', 'sidebar-hover', 'turn-stripe', 'ok-wash']) for (const [i, b] of bodies.entries()) assert.ok(b.includes('--v5-' + n + ':'), n + ' is declared inside rule body ' + i);
  assert.match(css, /\.A_hero \{ min-height: clamp\(12\.5rem, 32vh, 15\.75rem\); \}/); assert.match(css, /\.A_tabs\.card \{ padding: 4px;/); assert.match(css, /\.F_sheethead \*, \.E_grab \* \{ touch-action: none; \}/);
  assert.match(css, /\.A_card > \.row-between \{ flex-wrap: nowrap;/); assert.match(css, /mask-image: linear-gradient\(90deg, black 88%, transparent\)/);
  assert.match(css, /\.chk, \.H_chk \{ box-sizing: border-box; width: var\(--touch\); height: var\(--touch\);/);
  assert.doesNotMatch(read('lib.js').slice(read('lib.js').indexOf('function A_whatsNew'), read('lib.js').indexOf('function A_whatsNew') + 1800), /[Cc]ount/, 'nothing about counting stock in What is new');
});

test('H_ demo: the fixtures feed the new features and stay out of a cleaner payload', () => {
  const o = D.build('owner'), c = D.build('cleaner');
  assert.deepEqual(o.home.next_guest.arrival_ready, { id: false, paid: false, door_code: true }); assert.equal(c.home.next_guest.arrival_ready, undefined); assert.equal(CS.assertNoMoney(o.home, { allowContact: true }), true); assert.equal(CS.assertNoMoney(c.home, {}), true);
});

// ------------------------------------------------------------------------------------------------ fix round
const hashTo = async (app, h) => { app.location.hash = h; for (const f of app.winListeners.hashchange || []) f(); await app.flush(); };
test('H_ fix: a module that failed to load is retried on the next open; a throw in mount or unmount never leaves a blank screen or blocks navigation', async () => {
  let n = 0; const mounts = [];
  const app = await boot({ role: 'cleaner', hash: '#home', winInit: (win) => { win.H_loadAsset = (m) => { n++; if (n === 1) return Promise.reject(new Error('offline')); win[m.global] = { mount(el, o) { mounts.push(o); } }; return Promise.resolve(); }; }, handlers: baseHandlers('cleaner') });
  await hashTo(app, '#weather'); assert.equal(app.location.hash, '#calendar/notices', 'the first open falls back');
  await hashTo(app, '#weather'); assert.equal(n, 2, 'the second open loads again'); assert.equal(mounts.length, 1); assert.equal(app.location.hash, '#weather');
  const src = read('app.js'); assert.match(src, /sc\.onerror = function \(\) \{ \[sc, l\]\.forEach/); assert.match(src, /pr\.catch\(function \(\) \{ if \(H_mod\.p\[key\] === pr\) delete H_mod\.p\[key\]/);
  const mk = (mod) => (win) => { win.H_loadAsset = (m) => { win[m.global] = mod; return Promise.resolve(); }; };
  const t = await boot({ role: 'owner', hash: '#home', winInit: mk({ mount() { throw new Error('boom'); } }), handlers: baseHandlers('owner') }); await hashTo(t, '#manage'); assert.equal(t.location.hash, '#hub', 'mount threw: the route falls back');
  const r = await boot({ role: 'owner', hash: '#home', winInit: mk({ mount() { return Promise.reject(new Error('late')); } }), handlers: baseHandlers('owner') }); await hashTo(r, '#manage'); assert.equal(r.location.hash, '#hub', 'an async failure falls back too');
  let un = 0; const u = await boot({ role: 'admin', hash: '#home', winInit: mk({ mount() {}, unmount() { un++; throw new Error('x'); } }), handlers: baseHandlers('admin') });
  await hashTo(u, '#manage'); await u.click({ 'data-act': 'signout' }); assert.equal(un, 1, 'sign-out still goes ahead when unmount throws');
});

test('H_ fix: the offline strip is in the flow at the top of the page and never shows before a layout; an offline tick in the attention sheet says so too', async () => {
  const rule = /\.H_offline \{([^}]*)\}/.exec(read('styles.css'))[1]; assert.doesNotMatch(rule, /position: fixed/);
  assert.match(read('index.html'), /<div class="shell" id="app">\s*<div class="H_offline" id="H_offline" role="status" hidden><\/div>/);
  assert.match(read('app.js'), /var off = !!state\.layout && current !== 'door' && \(navigator\.onLine === false/, 'not before a layout exists, not inside a door');
  const app = await boot({ role: 'admin', hash: '#home', nav: { onLine: false }, handlers: baseHandlers('admin', { tasks_list_v1: tasksOf([T({ blocks_arrival: true })], true) }) });
  await app.click({ 'data-act': 'attn-open' }); await app.click({ 'data-act': 'task-done', 'data-task': 'follow_up_tasks:a' });
  assert.match(app.els['cs-body'].innerHTML, /H_noconn H_attoff" role="status">No connection</); assert.equal(app.calls.filter((c) => c[0] === 'task_set_done_v1').length, 0);
});

test('H_ fix: the tour waits while the Add to Home Screen hint is showing; sign-out forgets the search; only bottom sheets get the pull header', async () => {
  const ls = mem(); const hint = { classList: { contains: (c) => c === 'on', add() {}, remove() {} }, setAttribute() {}, getAttribute: () => null };
  const app = await boot({ role: 'cleaner', hash: '#home', tour: true, tourDelay: 0, ls, els: { a2hs: hint }, handlers: baseHandlers('cleaner') }); await new Promise((r) => setTimeout(r, 20));
  assert.ok(!app.els['cal-sheet'] || app.els['cal-sheet'].getAttribute('aria-hidden') !== 'false', 'no tour over the install hint'); assert.equal(ls.getItem('cs_seen_v3'), null, 'and it is not marked seen: it starts on the next open');
  assert.match(read('app.js'), /signOutTo\(msg\) \{\s*clearTimeout\(H_rpT\); state\.H_q = ''/); assert.match(read('styles.css'), /@media \(max-width: 37\.4375rem\) \{ \.F_sheethead \{ touch-action: none; \} \}/);
});

test('H_ fix: the three module folders are precached best effort, apart from the required shell list', () => {
  const sw = read('sw.js'), ctx = vm.createContext({ self: { addEventListener() {}, location: { href: 'https://x/' } }, URL, Request: class {}, Promise });
  vm.runInContext(sw.replace(/^const /gm, 'var ').replace(/^if \(typeof module[^\n]*$/m, ''), ctx); const opt = vm.runInContext('OPTIONAL_URLS', ctx), req = vm.runInContext('SHELL_URLS', ctx);
  assert.deepEqual([...opt], ['./weather/W_weather.js', './weather/W_weather.css', './stock/I_stock.js', './stock/I_stock.css', './stock/I_suppliers.js', './stock/I_suppliers.css', './manage/N_manage.js', './manage/N_manage.css', './manage/N_charts.js', './manage/N_charts.css', './manage/N_bookings.js', './manage/N_bookings.css', './manage/N_ops.js', './manage/N_ops.css', './guests/G_guests.js', './guests/G_guests.css', './inbox/X_inbox.js', './inbox/X_inbox.css']); for (const u of opt) assert.ok(!req.includes(u), u + ' is not in the required list');
  assert.match(sw, /SHELL_URLS\.concat\(OPTIONAL_URLS\)\.map\(\(u\) => cache\.add\(new Request\(u, \{ cache: 'reload' \}\)\)\.catch\(\(\) => \{\}\)\)/, 'a missing file is swallowed one by one');
});
