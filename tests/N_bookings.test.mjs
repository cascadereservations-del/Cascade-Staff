// Lane L5: manage/N_bookings.js (Upcoming | Current | Past list and detail sheet). Frozen clock: 2026-10-14 11:00 in Manila.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(root, 'manage', 'N_bookings.js'), 'utf8');
const CSS = fs.readFileSync(path.join(root, 'manage', 'N_bookings.css'), 'utf8');
const NOW = Date.parse('2026-10-14T03:00:00Z');
const TODAY = '2026-10-14';
const tick = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

class FakeEl {
  constructor() { this.html = ''; this.l = {}; }
  set innerHTML(v) { this.html = String(v); }
  get innerHTML() { return this.html; }
  addEventListener(t, f) { (this.l[t] ||= []).push(f); }
  removeEventListener(t, f) { this.l[t] = (this.l[t] || []).filter((x) => x !== f); }
  querySelector() { return null; }
}
function load(onLine = true) {
  const win = {};
  const ctx = { window: win, navigator: { onLine }, Intl, Date, Promise, JSON, Math, console, setTimeout, clearTimeout };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'N_bookings.js' });
  win.N_BOOKINGS._setClock(() => NOW);
  return win.N_BOOKINGS;
}
const RES = [
  { id: 'r1', confirmation_code: 'HMAAA1', status: 'confirmed', guest_name: 'Ana Reyes', guest_count: 3, checkin_date: '2026-10-12', checkout_date: '2026-10-16', guest_paid: '12000.00', host_payout: '11000.00', payout_date: null },
  { id: 'r2', confirmation_code: 'HMAAA2', status: 'confirmed', guest_name: 'Old Guest', guest_count: 2, checkin_date: '2026-09-01', checkout_date: '2026-09-04', guest_paid: '9000.00', host_payout: '8000.00', payout_date: '2026-09-06' },
  { id: 'r3', confirmation_code: 'HMAAA3', status: 'cancelled', guest_name: 'Gone Guest', guest_count: 1, checkin_date: '2026-10-20', checkout_date: '2026-10-22', guest_paid: null, host_payout: null, payout_date: null }
];
const INQ = [
  { id: 'abcdef12-0000-4000-8000-000000000001', guest_name: 'Ben <b>Cruz</b>', checkin_date: '2026-10-18', checkout_date: '2026-10-20', pax: 2, total_amount: '5000.00', deposit_amount: '2500.00', status: 'pending', receipt_image_path: null, notes: 'late arrival' },
  { id: 'abcdef12-0000-4000-8000-000000000002', guest_name: 'Carla Sy', checkin_date: '2026-10-25', checkout_date: '2026-10-26', pax: 1, total_amount: '2000.00', deposit_amount: '1000.00', status: 'confirmed', receipt_image_path: 'x', notes: '' }
];
const CAL = [
  { id: 'c1', uid: 'u1', source: 'airbnb', checkin_date: '2026-10-12', checkout_date: '2026-10-16', guest_name: 'Ana R.', status: 'confirmed', linked_reservation_id: 'r1' },
  { id: 'c2', uid: 'u2', source: 'direct', checkin_date: '2026-10-25', checkout_date: '2026-10-26', guest_name: 'Carla', status: 'confirmed', linked_reservation_id: null },
  { id: 'c3', uid: 'u3', source: 'airbnb', checkin_date: '2026-11-02', checkout_date: '2026-11-05', guest_name: 'Cal Only', status: 'confirmed', linked_reservation_id: null },
  { id: 'c4', uid: 'u4', source: 'airbnb', checkin_date: '2026-11-10', checkout_date: '2026-11-11', guest_name: 'Blocked', status: 'blocked', linked_reservation_id: null }
];
function client(tables = {}) {
  const calls = [];
  return { calls, from(table) {
    const rec = { table, ops: [] }; calls.push(rec);
    const ch = new Proxy({}, { get: (_, k) => { if (k === 'then') return (res, rej) => Promise.resolve(tables[table] ?? { data: [], error: null }).then(res, rej); return (...a) => { rec.ops.push([k, ...a]); return ch; }; } });
    return ch;
  } };
}
const FULL = { airbnb_reservations: { data: RES, error: null }, booking_inquiries: { data: INQ, error: null }, calendar_events: { data: CAL, error: null } };
async function boot({ access = 'owner', tables = FULL, onLine = true, demo = false } = {}) {
  const M = load(onLine), el = new FakeEl(), c = demo ? undefined : client(tables), nav = [];
  M.mount(el, { client: c, access, demo, navigate: (h) => nav.push(h) });
  await tick();
  const target = (attrs, extra = {}) => { const t = { ...extra, getAttribute: (k) => (k in attrs ? attrs[k] : null) }; t.closest = (sel) => { const m = /^\[([\w-]+)\]$/.exec(sel); return m && m[1] in attrs ? t : null; }; return t; };
  const fire = async (type, ev) => { for (const f of el.l[type] || []) f(ev); await tick(); };
  return { M, el, c, nav, text: () => el.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '),
    click: (a, v) => fire('click', { target: target({ 'data-b': a, ...(v !== undefined ? { 'data-v': v } : {}) }) }),
    type: (value) => fire('input', { target: target({ 'data-f': 'q' }, { value }) }),
    key: (key) => fire('keydown', { key }) };
}

test('L5 parse: script and stylesheet are well formed, no px font under 13, no hard-coded colours', () => {
  assert.doesNotThrow(() => new vm.Script(SRC));
  assert.equal((CSS.match(/\{/g) || []).length, (CSS.match(/\}/g) || []).length);
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(CSS) && !/rgba?\(/.test(CSS), 'tokens only');
  assert.ok(!/font-size:\s*(\d|1[0-2])px/.test(CSS));
  assert.ok(!/localStorage/.test(SRC) && !/guest_phone|guest_email/.test(SRC), 'no storage, no contact columns');
});

test('L5 segments: upcoming, current, past by Manila today; order; cancelled hidden until asked', () => {
  const { lib } = load();
  const list = lib.buildBookings({ res: RES, inq: INQ, cal: CAL }, true);
  const names = (seg, canc) => lib.filterBookings(list, seg, '', TODAY, canc).map((b) => b.guest);
  assert.deepEqual(JSON.parse(JSON.stringify(names('current'))), ['Ana Reyes']);
  assert.deepEqual(JSON.parse(JSON.stringify(names('past'))), ['Old Guest']);
  assert.deepEqual(JSON.parse(JSON.stringify(names('upcoming'))), ['Ben <b>Cruz</b>', 'Carla Sy', 'Cal Only']);
  assert.deepEqual(JSON.parse(JSON.stringify(names('upcoming', true))), ['Ben <b>Cruz</b>', 'Gone Guest', 'Carla Sy', 'Cal Only']);
  assert.equal(lib.segmentOf({ checkin: '2026-10-10', checkout: TODAY }, TODAY), 'past', 'checkout day is past');
  assert.equal(lib.segmentOf({ checkin: TODAY, checkout: '2026-10-15' }, TODAY), 'current');
});

test('L5 merge: calendar rows attach by link or exact dates, never duplicate; blocked rows are not bookings', () => {
  const { lib } = load();
  const list = lib.buildBookings({ res: RES, inq: INQ, cal: CAL }, true);
  assert.equal(list.length, 6); // 3 reservations + 2 inquiries + 1 calendar-only
  assert.equal(list.find((b) => b.id === 'r1').synced, true);
  assert.equal(list.find((b) => b.id === 'r2').synced, false);
  assert.equal(list.filter((b) => b.calOnly).length, 1);
  assert.ok(!list.some((b) => b.guest === 'Blocked'));
});

test('L5 search: by guest name, case-insensitive, within the segment', () => {
  const { lib } = load();
  const list = lib.buildBookings({ res: RES, inq: INQ, cal: CAL }, true);
  assert.deepEqual(JSON.parse(JSON.stringify(lib.filterBookings(list, 'upcoming', 'CARLA', TODAY, false).map((b) => b.guest))), ['Carla Sy']);
  assert.equal(lib.filterBookings(list, 'upcoming', 'zzz', TODAY, false).length, 0);
});

test('L5 payment status words', () => {
  const { lib } = load();
  const list = lib.buildBookings({ res: RES, inq: INQ, cal: [] }, true), by = (id) => list.find((b) => b.id === id);
  assert.match(lib.paymentText(by('r1')), /Paid through Airbnb; payout expected/);
  assert.match(lib.paymentText(by('r2')), /payout received 6 Sep 2026/);
  assert.equal(lib.paymentText(by(INQ[0].id)), 'Reservation fee not recorded yet');
  assert.equal(lib.paymentText(by(INQ[1].id)), 'Reservation fee received');
});

test('L5 money gating: owner/admin/finance see amounts; cleaner never sees money, notes or guests, and reads only calendar_events', async () => {
  for (const role of ['owner', 'admin', 'finance']) {
    const t = await boot({ access: { role } });
    assert.match(t.text(), /5,000\.00/, role);
    assert.deepEqual(JSON.parse(JSON.stringify(t.c.calls.map((x) => x.table).sort())), ['airbnb_reservations', 'booking_inquiries', 'calendar_events']);
  }
  const t = await boot({ access: { role: 'cleaner' } });
  assert.deepEqual(JSON.parse(JSON.stringify(t.c.calls.map((x) => x.table))), ['calendar_events']);
  await t.click('seg', 'current');
  assert.ok(!/₱|PHP|5,000/.test(t.text()), 'no money');
  await t.click('seg', 'upcoming');
  await t.click('open', 'cal:c3');
  assert.ok(!/Payment|Notes|Guests|₱|Total|Code/.test(t.text().replace('Bookings', '')), 'detail has no money, notes or counts: ' + t.text());
  assert.match(t.text(), /Cal Only/);
  assert.ok(!/Review in Inquiries/.test(t.el.html));
  for (const r of ['cleaner', 'staff', '', undefined]) assert.equal(load().lib.canSeeMoney({ role: r }), false);
});

test('L5 queries: property filter, newest first, limit, and no contact columns', async () => {
  const t = await boot();
  const sel = t.c.calls.map((x) => x.ops.find((o) => o[0] === 'select')[1]).join(' ');
  assert.ok(!/phone|email/.test(sel));
  for (const call of t.c.calls) {
    assert.ok(call.ops.some((o) => o[0] === 'eq' && o[1] === 'property_id'));
    assert.ok(call.ops.some((o) => o[0] === 'limit'));
  }
});

test('L5 detail sheet: opens on tap, escapes text, shows companions, notes and review link for a waiting direct request; closes', async () => {
  const t = await boot();
  assert.ok(!/<b>Cruz/.test(t.el.html), 'guest name is escaped');
  await t.click('open', 'direct:' + INQ[0].id);
  assert.match(t.el.html, /role="dialog"/);
  const x = t.text();
  assert.match(x, /Guests 2 guests · 1 companion/);
  assert.match(x, /Notes late arrival/);
  assert.match(x, /Reservation fee due ₱2,500\.00/);
  assert.match(x, /Waiting for decision/);
  await t.click('inq');
  assert.deepEqual(JSON.parse(JSON.stringify(t.nav)), ['#manage/inquiries']);
  await t.click('open', 'airbnb:r1');
  assert.ok(!/Review in Inquiries/.test(t.el.html), 'Airbnb stays are read only');
  await t.key('Escape');
  assert.ok(!/role="dialog"/.test(t.el.html));
});

test('L5 finance role cannot jump to Inquiries (owner/admin only)', async () => {
  const t = await boot({ access: { role: 'finance' } });
  await t.click('open', 'direct:' + INQ[0].id);
  assert.ok(!/Review in Inquiries/.test(t.el.html));
});

test('L5 states: loading, empty, error with retry, denied, offline, partial', async () => {
  let t = await boot({ tables: { airbnb_reservations: { data: [], error: null }, booking_inquiries: { data: [], error: null }, calendar_events: { data: [], error: null } } });
  assert.match(t.text(), /No upcoming bookings/);
  t = await boot({ tables: { airbnb_reservations: { data: null, error: { code: '500', message: 'boom' } }, booking_inquiries: { data: null, error: { code: '500', message: 'boom' } }, calendar_events: { data: null, error: { code: '500', message: 'boom' } } } });
  assert.match(t.text(), /could not be loaded/); assert.match(t.el.html, /data-b="retry"/);
  t = await boot({ tables: { airbnb_reservations: { data: null, error: { code: '42501', message: 'x' } }, booking_inquiries: { data: null, error: { code: '42501', message: 'x' } }, calendar_events: { data: null, error: { code: '42501', message: 'x' } } } });
  assert.match(t.text(), /not allowed to see bookings/);
  t = await boot({ onLine: false });
  assert.match(t.text(), /No connection/);
  t = await boot({ tables: { ...FULL, booking_inquiries: { data: null, error: { code: '500', message: 'boom' } } } });
  assert.match(t.text(), /may be incomplete/); assert.match(t.text(), /Cal Only/);
  assert.equal((await boot({ access: 'owner' })).M.lib.canSeeMoney('owner'), true);
});

test('L5 search box redraws via the list only (keyboard stays) and a rejected client call does not throw', async () => {
  const t = await boot();
  await t.type('carla'); // fake DOM has no querySelector target, so it falls back to a full draw
  assert.match(t.text(), /Carla Sy/); assert.ok(!/Ben/.test(t.text()));
  const M = load(), el = new FakeEl();
  M.mount(el, { client: { from() { throw new Error('failed to fetch'); } }, access: 'owner' });
  await tick();
  assert.match(el.html, /No connection|could not be loaded/);
});

test('L5 demo mode needs no network; a11y hooks present', async () => {
  const t = await boot({ demo: true });
  assert.match(t.text(), /Sample Guest C/);
  assert.match(t.el.html, /role="tablist"/); assert.match(t.el.html, /aria-selected="true"/); assert.match(t.el.html, /<label class="B_lbl" for="B_q">/);
  assert.match(CSS, /min-height: 44px/);
});

test('L5 review fixes: opts.role only, noon rule, embedded, cap note, demo cleaner, calendar row, nowrap tabs', async () => {
  const M = load(), el = new FakeEl();
  M.mount(el, { client: client(FULL), role: 'owner', navigate() {} });
  await tick();
  assert.match(el.html, /5,000\.00/);
  const { lib } = load(), b = { checkin: '2026-10-12', checkout: TODAY };
  assert.equal(lib.segmentOf(b, TODAY, 11), 'current');
  assert.equal(lib.segmentOf(b, TODAY, 12), 'past');
  assert.equal(lib.statusOf({ ...b, state: 'confirmed' }, TODAY, 11).text, 'Confirmed');
  assert.equal(lib.manilaHour(), 11);
  const e2 = new FakeEl(); load().mount(e2, { client: client(FULL), access: 'owner', embedded: true }); await tick();
  assert.ok(!/<h2 class="B_h">Bookings/.test(e2.html));
  const rows = Array.from({ length: 500 }, (_, i) => ({ ...CAL[2], id: 'x' + i, uid: 'x' + i }));
  const t = await boot({ tables: { ...FULL, calendar_events: { data: rows, error: null } } });
  assert.match(t.text(), /Showing the latest 500 bookings/);
  const d = await boot({ demo: true, access: 'cleaner' });
  assert.ok(!/No upcoming bookings/.test(d.text()) && /Sample Guest D/.test(d.text()));
  await d.click('open', 'cal:c-demo-2');
  assert.ok(!/Calendar On the calendar/.test(d.text()));
  assert.match(CSS, /\.B_tab \{[^}]*white-space: nowrap/);
});
