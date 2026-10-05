import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const CS = createRequire(import.meta.url)('../lib.js');

test('layout by role: six roles map to staff or admin, anything else is null', () => {
  for (const r of ['owner', 'admin', 'finance']) assert.equal(CS.layoutForRole(r), 'admin');
  for (const r of ['cleaner', 'inspector', 'maintenance']) assert.equal(CS.layoutForRole(r), 'staff');
  for (const r of ['guest', '', null, undefined]) assert.equal(CS.layoutForRole(r), null);
});

test('access verdict: no profile, disabled and a revoked session are shut out with plain words', () => {
  assert.equal(CS.accessVerdict(null).ok, false);
  assert.match(CS.accessVerdict(null).message, /no staff profile/);
  assert.match(CS.accessVerdict({ role: 'cleaner', disabled: true, session_current: true }).message, /turned off/);
  assert.match(CS.accessVerdict({ role: 'cleaner', disabled: false, session_current: false }).message, /turned off/);
  assert.equal(CS.accessVerdict({ role: 'admin', disabled: false, session_current: true }).ok, true);
  assert.equal(CS.accessVerdict({ role: 'nobody', disabled: false, session_current: true }).ok, false);
});

test('login rules: a name becomes the staff address, 4 digits get the prefix, an e-mail and a password pass through', () => {
  assert.equal(CS.staffLoginEmail('Honey'), 'honey@staff.cascade.invalid');
  assert.equal(CS.staffLoginEmail('  Mary Ann  '), 'mary.ann@staff.cascade.invalid');
  assert.equal(CS.staffLoginEmail('Marifel@Example.com'), 'marifel@example.com');
  assert.equal(CS.staffAuthPassword('1234'), '88881234');
  assert.equal(CS.staffAuthPassword('a-long-password'), 'a-long-password');
  assert.equal(CS.staffAuthPassword('12345'), '12345');
});

test('display name: display_name, then name, then the e-mail local part', () => {
  assert.equal(CS.deriveDisplayName({ user_metadata: { display_name: ' Honey ' } }), 'Honey');
  assert.equal(CS.deriveDisplayName({ app_metadata: { display_name: 'Marifel' } }), 'Marifel');
  assert.equal(CS.deriveDisplayName({ user_metadata: { name: 'Lloyd' } }), 'Lloyd');
  assert.equal(CS.deriveDisplayName({ email: 'mary.ann@staff.cascade.invalid' }), 'Mary Ann');
  assert.equal(CS.deriveDisplayName({}), 'Staff');
});

test('assertNoMoney refuses money and contact keys at any depth, and passes the real payload shape', () => {
  for (const k of ['amount', 'total_amount', 'deposit', 'guest_phone', 'email', 'priceTotal', 'fee', 'fees', 'payout', 'phone_e164']) {
    assert.throws(() => CS.assertNoMoney({ a: [{ b: { [k]: 1 } }] }), /money or contact keys/, k);
  }
  const ok = {
    role: 'cleaner', today: '2026-10-05', property_id: 'x',
    calendar: [{ uid: 'u', guest_name: 'A', checkin_date: '2026-10-05', checkout_date: '2026-10-06', nights: 1, status: 'confirmed', source: 'airbnb', checkin_time: null, checkout_time: null }],
    current_guest: { uid: 'u', repeat: true, stay_count: 2, earlier_stays: [{ month: '2026-06', nights: 2 }], notes: 'x', id_photo_path: 'a/b.jpg' },
    next_guest: null,
    warnings: [{ kind: 'brownout', severity: 'alert', title: 't', detail: { date: '2026-10-08', time: '06:00:00', hours: 11, grid_line: 'F3', posted_by: 'Honey' }, at: 'z' },
      { kind: 'inventory', severity: 'warn', title: 'Low stock: x', detail: { qty: 2, unit: 'rolls', reorder_below: 6 }, at: 'z' }],
    weather: { source: 's', fetched_at: 'z', current: { temp: 29, emoji: 'x', description: 'rain', rain_prob: 70, today_high: 31, today_low: 25, humidity: 80, uv_label: 'High' } },
    generated_at: 'z'
  };
  assert.equal(CS.assertNoMoney(ok), true);
  // the old substring rule would have refused "feeder" and "feels_like"; whole words do not
  assert.equal(CS.assertNoMoney({ grid_line: 'F3', feels_like: 30, feeder: 'F3' }), true);
});

test('dates: Manila today, add days, month grid is Monday first', () => {
  assert.equal(CS.manilaToday(new Date('2026-10-05T16:30:00Z')), '2026-10-06'); // 00:30 next day in Manila
  assert.equal(CS.manilaToday(new Date('2026-10-05T15:59:00Z')), '2026-10-05');
  assert.equal(CS.addDays('2026-10-30', 3), '2026-11-02');
  assert.equal(CS.addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(CS.daysBetween('2026-10-05', '2026-10-08'), 3);
  const g = CS.monthGrid(2026, 10); // 1 Oct 2026 is a Thursday: three blanks first
  assert.equal(g.length % 7, 0);
  assert.deepEqual(g.slice(0, 4).map((c) => c.iso), [null, null, null, '2026-10-01']);
  assert.equal(g.filter((c) => c.iso).length, 31);
  assert.equal(CS.monthGrid(2026, 2).filter((c) => c.iso).length, 28);
  assert.equal(CS.monthGrid(2027, 2)[0].iso, '2027-02-01'); // a Monday: no blanks
});

test('labels and formatting', () => {
  assert.equal(CS.dayLabel('2026-10-05'), '5 Oct');
  assert.equal(CS.dayLong('2026-10-05'), 'Monday 5 October');
  assert.equal(CS.dayShort('2026-10-08'), 'Thu 8 Oct');
  assert.equal(CS.monthTitle(2026, 10), 'October 2026');
  assert.equal(CS.fmtTime('14:00:00'), '2:00 PM');
  assert.equal(CS.fmtTime('12:00:00'), '12:00 noon');
  assert.equal(CS.fmtTime('00:30:00'), '12:30 AM');
  assert.equal(CS.fmtTime(null), null);
  assert.equal(CS.ordinal(1), '1st'); assert.equal(CS.ordinal(2), '2nd'); assert.equal(CS.ordinal(3), '3rd');
  assert.equal(CS.ordinal(4), '4th'); assert.equal(CS.ordinal(11), '11th'); assert.equal(CS.ordinal(22), '22nd');
  assert.equal(CS.greeting(new Date('2026-10-05T00:00:00Z')), 'Good morning'); // 08:00 Manila
  assert.equal(CS.greeting(new Date('2026-10-05T06:00:00Z')), 'Good afternoon'); // 14:00
  assert.equal(CS.greeting(new Date('2026-10-05T12:00:00Z')), 'Good evening'); // 20:00
  assert.equal(CS.agoLabel('2026-10-05T10:00:00Z', new Date('2026-10-05T10:02:10Z')), '2 mins ago');
  assert.equal(CS.agoLabel('2026-10-05T10:00:00Z', new Date('2026-10-05T10:00:20Z')), 'just now');
  assert.equal(CS.monthShortYear('2026-06'), 'Jun 2026');
});

test('day state: a stay holds nights from check-in to the night before check-out; blocked days are marked', () => {
  const rows = [
    { status: 'confirmed', checkin_date: '2026-10-07', checkout_date: '2026-10-09', guest_name: 'Beth' },
    { status: 'blocked', checkin_date: '2026-10-14', checkout_date: '2026-10-16', guest_name: null }
  ];
  assert.equal(CS.dayState('2026-10-06', rows).stay, null);
  const d7 = CS.dayState('2026-10-07', rows); assert.equal(d7.stay.guest_name, 'Beth'); assert.equal(d7.startsHere, true); assert.equal(d7.cont, true);
  const d8 = CS.dayState('2026-10-08', rows); assert.equal(d8.stay.guest_name, 'Beth'); assert.equal(d8.cont, false);
  assert.equal(CS.dayState('2026-10-09', rows).stay, null); // check-out day is free
  assert.equal(CS.dayState('2026-10-15', rows).blocked, true);
  assert.equal(CS.dayState('2026-10-16', rows).blocked, false);
  assert.equal(CS.initialOf(' beth'), 'B'); assert.equal(CS.initialOf(null), '');
});

test('month range: only months inside the 7 back to 60 forward window can be opened', () => {
  assert.equal(CS.monthInRange(2026, 10, '2026-10-05'), true);
  assert.equal(CS.monthInRange(2026, 12, '2026-10-05'), true); // 5 Dec = +61 is out, but 1-4 Dec is inside
  assert.equal(CS.monthInRange(2027, 1, '2026-10-05'), false);
  assert.equal(CS.monthInRange(2026, 9, '2026-10-05'), true); // 28-30 Sep are inside 7 days back
  assert.equal(CS.monthInRange(2026, 8, '2026-10-05'), false);
});

test('notes parse into per-stay groups, important points first, undated chunks kept', () => {
  const g = CS.parseNotes('2026-08-01: Likes extra towels | Reported a damage to the kettle || 2026-02-10: Late check-out requested | Brought a gift || VIP - repeat guest');
  assert.equal(g.length, 3);
  assert.equal(g[0].date, '2026-08-01'); assert.equal(g[0].points[0], 'Reported a damage to the kettle');
  assert.equal(g[1].points[0], 'Late check-out requested');
  assert.equal(g[2].date, null); assert.deepEqual(g[2].points, ['VIP - repeat guest']);
  assert.deepEqual(CS.parseNotes(null), []);
  assert.deepEqual(CS.parseNotes(''), []);
});

test('returning marker: only a known repeat guest gets one; unknown is null, never a first-stay claim', () => {
  assert.equal(CS.returningLabel({ repeat: true, stay_count: 3 }), 'Returning guest · 3rd stay');
  assert.equal(CS.returningLabel({ repeat: true, stay_count: 3 }, true), 'Returning · 3rd stay');
  assert.equal(CS.returningLabel({ repeat: false, stay_count: 1 }), null);
  assert.equal(CS.returningLabel({ repeat: null, stay_count: null }), null);
  assert.equal(CS.returningLabel(null), null);
  assert.equal(CS.earlierLine({ earlier_stays: [{ month: '2026-06', nights: 2 }, { month: '2026-02', nights: 3 }] }), 'Earlier stays: Jun 2026 · 2 nights, Feb 2026 · 3 nights');
  assert.equal(CS.earlierLine({ earlier_stays: [{ month: '2026-06', nights: null }] }), 'Earlier stays: Jun 2026');
  assert.equal(CS.earlierLine({ earlier_stays: [] }), null);
});

test('today card: in the house, arriving today, next, or nobody', () => {
  const cur = { guest_name: 'A', checkin_date: '2026-10-04', checkout_date: '2026-10-06' };
  const nxt = { guest_name: 'B', checkin_date: '2026-10-07', checkout_date: '2026-10-09' };
  assert.equal(CS.todayCardState({ current_guest: cur, next_guest: nxt }, '2026-10-05').kind, 'house');
  assert.equal(CS.todayCardState({ current_guest: cur }, '2026-10-05').pill.text, 'Checked in');
  assert.equal(CS.todayCardState({ current_guest: { ...cur, checkin_date: '2026-10-05' } }, '2026-10-05').pill.text, 'Arrived today');
  assert.equal(CS.todayCardState({ current_guest: null, next_guest: { ...nxt, checkin_date: '2026-10-05' } }, '2026-10-05').kind, 'arriving');
  assert.equal(CS.todayCardState({ current_guest: null, next_guest: nxt }, '2026-10-05').kind, 'next');
  assert.equal(CS.todayCardState({ current_guest: null, next_guest: null }, '2026-10-05').kind, 'none');
});

test('warnings: brownouts first, then red findings, then low stock, then the other findings; input order kept inside a rank', () => {
  const list = [
    { kind: 'verifier', severity: 'warn', title: 'w' }, { kind: 'inventory', severity: 'warn', title: 'i1' },
    { kind: 'verifier', severity: 'alert', title: 'a' }, { kind: 'brownout', severity: 'alert', title: 'b1' },
    { kind: 'inventory', severity: 'warn', title: 'i2' }, { kind: 'brownout', severity: 'alert', title: 'b2' }
  ];
  assert.deepEqual(CS.orderWarnings(list).map((w) => w.title), ['b1', 'b2', 'a', 'i1', 'i2', 'w']);
  assert.deepEqual(CS.orderWarnings(null), []);
});

test('warning text and the one-line summary', () => {
  const b = CS.brownoutText({ title: 'SOCOTECO II power interruption', detail: { date: '2026-10-08', time: '06:00:00', hours: 11, grid_line: '14-3', posted_by: 'Honey' } });
  assert.equal(b.head, 'Brownout Thu 8 Oct 06:00, 11 h');
  assert.equal(b.rest, 'SOCOTECO II power interruption · feeder 14-3 · posted by Honey');
  assert.equal(CS.brownoutText({ title: 'Brownout', detail: { date: '2026-10-08' } }).head, 'Brownout Thu 8 Oct');
  const l = CS.lowStockText({ title: 'Low stock: Toilet paper', detail: { qty: 2, unit: 'rolls', reorder_below: 6 } });
  assert.deepEqual(l, { head: 'Low stock', rest: 'Toilet paper, 2 rolls (reorder below 6)' });
  assert.equal(CS.warningSummary([]).text, 'No warnings today');
  const s = CS.warningSummary([
    { kind: 'brownout', detail: { date: '2026-10-11' } }, { kind: 'brownout', detail: { date: '2026-10-15' } }, { kind: 'inventory', detail: {} }
  ]);
  assert.equal(s.count, 3); assert.equal(s.text, '3 warnings · brownouts 11 and 15 Oct · low stock');
  assert.equal(CS.warningSummary([{ kind: 'brownout', detail: { date: '2026-10-15' } }]).text, '1 warning · brownout 15 Oct');
  assert.equal(CS.warningSummary([{ kind: 'verifier', detail: {} }]).text, '1 warning · 1 system check');
});

test('weather lines and staleness', () => {
  const w = { fetched_at: '2026-10-05T01:00:00Z', current: { temp: 28.6, description: 'Light Rain', rain_prob: 70, today_high: 31, today_low: 25 } };
  assert.equal(CS.weatherLine(w, '2026-10-05'), 'Monday 5 October · 29° light rain');
  assert.deepEqual(CS.rainLine(w), { head: 'Rain 70% today', rest: '25 to 31°' });
  assert.equal(CS.weatherLine(null, '2026-10-05'), null);
  assert.equal(CS.weatherStale(w, new Date('2026-10-05T02:00:00Z')), false);
  assert.equal(CS.weatherStale(w, new Date('2026-10-05T03:00:00Z')), true);
  assert.equal(CS.weatherStale(null), true);
});

test('esc neutralises markup', () => {
  assert.equal(CS.esc('<img src=x onerror="a">&\''), '&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;');
  assert.equal(CS.esc(null), '');
});
