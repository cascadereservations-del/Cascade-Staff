// Lane E (streamline pass): CS.E_attention, the one count behind the notification pill. Pure, frozen clock (today is passed in, never read).
import test from 'node:test';
import assert from 'node:assert/strict';
import { CS } from './_a_harness.mjs';

const TODAY = '2026-10-15';
const task = (o) => Object.assign({ source: 'follow_up_tasks', id: 't' + Math.random().toString(16).slice(2, 6), kind: 'reminder', title: 'A task', status: 'open', priority: 'normal', due_at: null, blocks_arrival: false, mine: true }, o);
const READY = { payload: true, tasks: true, bookings: true, notices: true };
const base = (role, o) => Object.assign({ role, today: TODAY, ready: READY, tasks: [], clashDays: [], bookings: 0, inbox: null, warnings: [], notices: [] }, o || {});
const brown = { kind: 'brownout', title: 'SOCOTECO II', severity: 'warn', detail: { date: '2026-10-16', time: '13:00', hours: 3 } };
const low = { kind: 'inventory', title: 'Low stock: dish soap', detail: { qty: 1, unit: 'pc', reorder_below: 3 } };
const sys = { kind: 'verifier', title: 'Airbnb block runs past the last guest night', severity: 'alert', detail: { check_id: 'V1m' } };

test('E_attention: nothing to say is "All clear", tone ok, no rows, n = 0', () => {
  for (const role of ['cleaner', 'admin', 'owner', 'finance']) {
    const a = CS.E_attention(base(role));
    assert.equal(a.phase, 'clear'); assert.equal(a.n, 0); assert.equal(a.tone, 'ok'); assert.equal(a.top, ''); assert.deepEqual(a.sections, []);
    assert.deepEqual(a.pill, { text: 'All clear', short: 'All clear', dot: 'ok', glyph: 'check', aria: 'All clear. Nothing needs attention. Opens the list' });
  }
});

test('E_attention: Loading until the role\'s own data has resolved; a failed optional probe resolves it, never holds it', () => {
  assert.equal(CS.E_attention(base('cleaner', { ready: { payload: false, tasks: true } })).phase, 'loading');
  assert.equal(CS.E_attention(base('cleaner', { ready: { payload: true, tasks: false } })).phase, 'loading');
  assert.equal(CS.E_attention(base('cleaner', { ready: { payload: true, tasks: true } })).phase, 'clear', 'a cleaner needs only the payload and her tasks');
  assert.equal(CS.E_attention(base('admin', { ready: { payload: true, tasks: true, bookings: false, notices: true } })).phase, 'loading');
  assert.equal(CS.E_attention(base('admin', { ready: { payload: true, tasks: true, bookings: true, notices: false } })).phase, 'loading');
  assert.equal(CS.E_attention(base('owner', { ready: { payload: true, tasks: true, bookings: true, notices: true } })).phase, 'clear');
  const l = CS.E_attention(base('admin', { ready: {} })).pill;
  assert.deepEqual(l, { text: 'Loading', short: 'Loading', dot: 'idle', glyph: 'refresh', aria: 'Loading what needs attention' });
});

test('E_attention: no connection wins over everything, with or without old data, and says when the last update was', () => {
  const lastAt = '2026-10-15T04:34:00Z'; // 12:34 Manila
  const a = CS.E_attention(base('admin', { error: true, lastAt, tasks: [task({ blocks_arrival: true })] }));
  assert.equal(a.phase, 'offline'); assert.deepEqual(a.pill, { text: 'No connection', short: 'No connection', dot: 'idle', glyph: 'info', aria: 'No connection. Showing the last update from 12:34. Opens the list' });
  assert.equal(CS.E_attention(base('cleaner', { error: true, ready: {} })).pill.aria, 'No connection. Opens the list');
  assert.ok(a.sections.length === 1, 'the old rows are still there for the sheet');
});

test('E_attention: one row says it by name, many say the count and the most urgent; the narrow text is "N to look at"', () => {
  const one = CS.E_attention(base('cleaner', { tasks: [task({ blocks_arrival: true, due_at: '2026-10-12T09:00:00Z' })] }));
  assert.equal(one.n, 1); assert.equal(one.top, 'Turnover at risk'); assert.equal(one.tone, 'danger');
  assert.deepEqual(one.pill, { text: '1 task · 1 blocks arrival', short: '1 to look at', dot: 'bad', glyph: 'alert', aria: '1 thing to look at: turnover at risk. Opens the list' });
  const many = CS.E_attention(base('cleaner', { tasks: [task({ blocks_arrival: true }), task({ due_at: '2026-10-10T09:00:00Z' }), task({ due_at: '2026-10-11T09:00:00Z' })] }));
  assert.equal(many.n, 3); assert.equal(many.pill.text, '3 tasks · 1 blocks arrival'); assert.equal(many.pill.short, '3 to look at');
  assert.equal(many.pill.aria, '3 things to look at. Most urgent: turnover at risk. Opens the list');
  const warn = CS.E_attention(base('cleaner', { warnings: [low] }));
  assert.deepEqual([warn.tone, warn.pill.dot, warn.pill.glyph, warn.pill.text], ['warn', 'warn', 'clock', '1 · Low stock']);
});

test('E_attention: priority order is risk, overdue, clash, to confirm, inbox, warnings, then (uncounted) notices; tone follows the first group', () => {
  const a = CS.E_attention(base('owner', {
    tasks: [task({ title: 'Overdue one', due_at: '2026-10-10T09:00:00Z' }), task({ title: 'Risk one', blocks_arrival: true })],
    clashDays: ['2026-10-20', '2026-10-18'], bookings: 2, inbox: 3, warnings: [low, sys, brown],
    notices: [{ key: 'n:1', type: 'water', title: 'No water', date: '2026-10-16', sub: 'Fri 16 Oct · GSCWD' }] }));
  assert.deepEqual(a.sections.map((s) => s.key), ['risk', 'overdue', 'clash', 'confirm', 'inbox', 'warn', 'notice']);
  assert.equal(a.n, 1 + 1 + 2 + 1 + 1 + 3, 'rows in groups 1 to 6; the notice is not counted');
  assert.deepEqual(a.sections[2].rows.map((r) => r.id), ['2026-10-18', '2026-10-20'], 'clash days in date order');
  assert.deepEqual(a.sections[5].rows.map((r) => r.word), ['Brownout Fri', 'System check', 'Low stock'], 'brownout, then the red finding, then low stock');
  assert.equal(a.top, 'Turnover at risk'); assert.equal(a.tone, 'danger');
  // tone and top follow the first non-empty group
  const b = CS.E_attention(base('admin', { bookings: 4, inbox: 1 })); assert.equal(b.tone, 'warn'); assert.equal(b.top, '4 to confirm'); assert.equal(b.pill.text, '2 · To confirm');
  const c = CS.E_attention(base('admin', { tasks: [task({ due_at: '2026-10-10T09:00:00Z' }), task({ due_at: '2026-10-11T09:00:00Z' })] })); assert.equal(c.top, '2 overdue'); assert.equal(c.pill.text, '2 · Overdue');
  const d = CS.E_attention(base('admin', { clashDays: ['2026-10-18'] })); assert.equal(d.top, 'Clash day'); assert.equal(d.tone, 'danger');
  assert.equal(CS.E_attention(base('admin', { clashDays: ['2026-10-18', '2026-10-19'] })).top, '2 clash days');
  assert.equal(CS.E_attention(base('owner', { inbox: 2 })).top, '2 in inbox');
  assert.equal(CS.E_attention(base('owner', { warnings: [sys] })).top, 'System check');
  assert.equal(CS.E_attention(base('owner', { warnings: [brown] })).top, 'Brownout Fri');
});

test('E_attention: a task that blocks the arrival and is overdue is said once (as the risk), done tasks never count', () => {
  const t = task({ blocks_arrival: true, due_at: '2026-10-10T09:00:00Z' });
  const a = CS.E_attention(base('admin', { tasks: [t, task({ status: 'done', blocks_arrival: true }), task({ status: 'done', due_at: '2026-10-01T00:00:00Z' })] }));
  assert.equal(a.n, 1); assert.deepEqual(a.sections.map((s) => s.key), ['risk']);
  assert.match(a.sections[0].rows[0].sub, /^Blocks the next arrival · Was due 10 Oct/);
});

test('E_attention: notices are shown for today and tomorrow, never counted, and a brownout already named by a warning is not said twice', () => {
  const notices = [{ key: 'n:p', type: 'power', title: 'Brownout 1:00 to 4:00 pm', date: '2026-10-16', sub: 'Fri 16 Oct · SOCOTECO II' }, { key: 'rain-watch', type: 'rain', title: 'Rain watch, 2 to 5 pm', date: TODAY, sub: '80% chance today' },
    { key: 'n:w', type: 'water', title: 'No water', date: '2026-10-17', sub: 'x' }, { key: 'n:old', type: 'water', title: 'Old', date: '2026-10-14', sub: 'x' }];
  const a = CS.E_attention(base('cleaner', { notices }));
  assert.equal(a.n, 0); assert.equal(a.phase, 'clear'); assert.deepEqual(a.sections.map((s) => s.key), ['notice']);
  assert.deepEqual(a.sections[0].rows.map((r) => r.title), ['Brownout 1:00 to 4:00 pm', 'Rain watch, 2 to 5 pm'], 'tomorrow and today only');
  assert.equal(a.empty, false, 'the sheet has something to show even though the pill says All clear');
  const b = CS.E_attention(base('cleaner', { notices, warnings: [brown] }));
  assert.deepEqual(b.sections.map((s) => s.key), ['warn', 'notice']); assert.deepEqual(b.sections[1].rows.map((r) => r.title), ['Rain watch, 2 to 5 pm']);
});

test('E_attention: a group shows three rows and "more" holds the whole count for See all', () => {
  const tasks = [1, 2, 3, 4, 5].map((i) => task({ title: 'Risk ' + i, blocks_arrival: true }));
  const a = CS.E_attention(base('admin', { tasks }));
  assert.equal(a.sections[0].shown.length, 3); assert.equal(a.sections[0].more, 5); assert.equal(a.sections[0].rows.length, 5);
  assert.equal(CS.E_attention(base('admin', { tasks: tasks.slice(0, 3) })).sections[0].more, 0);
});

test('E_attention: the number is capped at 99+', () => {
  const tasks = Array.from({ length: 120 }, (_, i) => task({ id: 'x' + i, blocks_arrival: true }));
  const a = CS.E_attention(base('admin', { tasks }));
  assert.equal(a.n, 120); assert.equal(a.pill.text, '99+ tasks · 120 block arrival'); assert.equal(a.pill.short, '99+ to look at'); assert.match(a.pill.aria, /^99\+ things to look at/);
});

test('E_attention: a cleaner never gets clash days, bookings, the inbox or a system check, even if the input smuggles them in', () => {
  for (const role of ['cleaner', 'inspector', 'maintenance']) {
    const a = CS.E_attention(base(role, { clashDays: ['2026-10-18'], bookings: 5, inbox: 4, warnings: [sys, low, brown], tasks: [task({ blocks_arrival: true })] }));
    assert.deepEqual(a.sections.map((s) => s.key), ['risk', 'warn'], role); assert.deepEqual(a.sections[1].rows.map((r) => r.word), ['Brownout Fri', 'Low stock'], role);
    assert.doesNotMatch(JSON.stringify(a), /clash|confirm|inbox|System check|bookings/i, role);
  }
  // finance has the money roles' rows but not the inbox or the guest-contact system check
  const f = CS.E_attention(base('finance', { clashDays: ['2026-10-18'], bookings: 2, inbox: 4, warnings: [sys] }));
  assert.deepEqual(f.sections.map((s) => s.key), ['clash', 'confirm']);
  // owner and admin have all of it
  assert.deepEqual(CS.E_attention(base('admin', { inbox: 2, warnings: [sys] })).sections.map((s) => s.key), ['inbox', 'warn']);
});

test('E_attention: clash days outside the next 60 days, duplicates and junk are dropped', () => {
  const a = CS.E_attention(base('admin', { clashDays: ['2026-10-14', '2026-12-14', '2026-12-13', '2026-10-30', '2026-10-30', 5, null] }));
  assert.deepEqual(a.sections[0].rows.map((r) => r.id), ['2026-10-30', '2026-12-13']);
});

test('E_attention: the output carries no money or contact keys and every row says where it goes', () => {
  const a = CS.E_attention(base('owner', { tasks: [task({ blocks_arrival: true })], clashDays: ['2026-10-18'], bookings: 2, inbox: 3, warnings: [brown, low, sys], notices: [{ key: 'n:1', type: 'water', title: 'No water', date: TODAY, sub: 's' }] }));
  assert.equal(CS.assertNoMoney(a), true);
  const kinds = a.sections.flatMap((s) => s.rows.map((r) => r.go.kind)); assert.deepEqual(kinds, ['tasks', 'day', 'bookings', 'inbox', 'notices', 'warn', 'inventory', 'notices']);
  assert.equal(a.sections[0].rows[0].go.filter, 'blocks'); assert.equal(a.sections[2].rows[0].go.kind, 'bookings');
  const sysRow = a.sections.find((s) => s.key === 'warn').rows.find((r) => r.go.kind === 'warn'); assert.equal(sysRow.go.key, CS.E_warnKey(sys));
});

test('bookingsToConfirmRow: the in-app door when the dashboard is folded in, the old stand-alone URL only as the fallback', () => {
  const door = { href: '#door/dashboard/bookings/inquiries', external: false };
  const folded = CS.bookingsToConfirmRow('admin', [{}, {}], door);
  assert.deepEqual({ n: folded.n, count: folded.count, href: folded.href, external: folded.external }, { n: 2, count: '2', href: '#door/dashboard/bookings/inquiries', external: false });
  const ext = CS.bookingsToConfirmRow('owner', 1, { href: './admin/#/bookings/inquiries', external: true }); assert.equal(ext.href, './admin/#/bookings/inquiries'); assert.equal(ext.external, true);
  const old = CS.bookingsToConfirmRow('owner', 3); assert.equal(old.href, CS.INQUIRIES_URL); assert.equal(old.external, true);
  assert.equal(CS.bookingsToConfirmRow('cleaner', 3, door), null); assert.equal(CS.bookingsToConfirmRow('owner', 0, door), null);
});

test('taskPriorityLabel and the notice sub: plain words, and the time is said once', () => {
  assert.deepEqual(['high', 'urgent', 'normal', 'low', undefined].map(CS.taskPriorityLabel), ['High priority', 'Urgent', '', '', '']);
  assert.equal(CS.taskGroups([task({})], TODAY)[0].label, 'No due date');
  const raw = { notices: [{ id: 'a', type: 'power', title: 'Brownout 1:00 to 4:00 pm', date: '2026-10-16', start_time: '13:00', end_time: '16:00', source: 'socoteco' }, { id: 'b', type: 'water', title: 'No water', date: '2026-10-17', start_time: '09:00', end_time: '15:00', source: 'gscwd' }] };
  const v = CS.A_noticesView(raw, 'cleaner', TODAY);
  assert.equal(v.list[0].sub, 'Fri 16 Oct · SOCOTECO II', 'the title already says the time: the sub is date and source only');
  assert.equal(v.list[1].sub, 'Sat 17 Oct · 9:00 am to 3:00 pm · GSCWD', 'a title with no time keeps the time in the sub');
  const w = CS.A_noticesView({ weather: { temp_c: 29, rain_watch: { from: '2026-10-15T06:00:00Z', to: '2026-10-15T09:00:00Z', peak_pct: 80 } }, notices: [] }, 'cleaner', TODAY);
  assert.deepEqual([w.list[0].title, w.list[0].sub], ['Rain watch, 2 to 5 pm', '80% chance today']);
});
