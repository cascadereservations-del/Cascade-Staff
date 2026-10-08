import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const CS = createRequire(import.meta.url)('../lib.js');

// The real case from 8 Oct 2026: Angel's direct stay 8-11 Oct, the Airbnb mirror block 8-12 Oct (one extra night).
const rows = [
  { uid: 's1', status: 'confirmed', guest_name: 'Angeleen', checkin_date: '2026-10-08', checkout_date: '2026-10-11', source: 'direct' },
  { uid: 'b1', status: 'blocked', guest_name: null, checkin_date: '2026-10-08', checkout_date: '2026-10-12', block_reason: 'direct', block_label: 'Direct booking BD296460' },
  { uid: 'b2', status: 'blocked', guest_name: null, checkin_date: '2026-10-14', checkout_date: '2026-10-16', block_reason: null, block_label: null }
];

test('day status: booked beats blocked beats free; the why line says the guest or the block label', () => {
  const d9 = CS.dayStatus('2026-10-09', rows, [], []);
  assert.equal(d9.primary, 'booked'); assert.equal(d9.why, 'Angeleen'); assert.equal(d9.block.uid, 'b1', 'the block under a stay is still known');
  const d11 = CS.dayStatus('2026-10-11', rows, [], []);
  assert.equal(d11.primary, 'blocked'); assert.equal(d11.why, 'Direct booking BD296460');
  assert.equal(CS.dayStatus('2026-10-14', rows, [], []).why, 'Blocked', 'no label falls back to Blocked');
  const d13 = CS.dayStatus('2026-10-13', rows, [], []);
  assert.equal(d13.primary, 'free'); assert.equal(d13.stay, null); assert.equal(d13.block, null);
});

test('day status: secondary flags ride on any primary; without day_flags, brownouts come from the warnings', () => {
  const flags = [
    { date: '2026-10-09', kind: 'maintenance', label: 'Aircon', source: 'manual', id: 'f1' },
    { date: '2026-10-09', kind: 'brownout', label: 'Brownout (SOCOTECO)', source: 'auto', id: null },
    { date: '2026-10-09', kind: 'party', label: 'x', source: 'manual', id: 'f2' },
    { date: '2026-10-13', kind: 'deep_clean', label: 'Deep clean', source: 'manual', id: 'f3' }
  ];
  const d9 = CS.dayStatus('2026-10-09', rows, flags, []);
  assert.equal(d9.primary, 'booked'); assert.deepEqual(d9.flags.map((f) => f.kind), ['maintenance', 'brownout'], 'unknown kinds are dropped');
  assert.deepEqual(CS.dayStatus('2026-10-13', rows, flags, []).flags.map((f) => f.kind), ['deep_clean']);
  const warnings = [{ kind: 'brownout', detail: { date: '2026-10-15' } }, { kind: 'inventory', detail: {} }];
  const d15 = CS.dayStatus('2026-10-15', rows, undefined, warnings);
  assert.equal(d15.primary, 'blocked'); assert.deepEqual(d15.flags.map((f) => [f.kind, f.source]), [['brownout', 'auto']]);
  assert.equal(CS.dayStatus('2026-10-15', rows, [], warnings).flags.length, 0, 'an empty day_flags list is the truth, no fallback');
  assert.equal(CS.flagName('deep_clean'), 'Deep cleaning');
  const two = rows.concat([{ status: 'blocked', checkin_date: '2026-10-11', checkout_date: '2026-10-12', block_label: 'Maintenance' }, { status: 'blocked', checkin_date: '2026-10-11', checkout_date: '2026-10-12', block_label: null }]);
  const d11 = CS.dayStatus('2026-10-11', two, [], []);
  assert.equal(d11.why, 'Direct booking BD296460 · Maintenance', 'every reason on a night, each once, no bare Blocked beside a real one');
  assert.equal(d11.blocks.length, 3);
});

test('blocked nights list: says why, and a mirror block shows only its extra night after checkout', () => {
  const lines = CS.blockedLines(rows, '2026-10-08');
  assert.deepEqual(lines.map(CS.blockedLineText), ['11 Oct · Direct booking BD296460 · one night after checkout', '14 Oct to 15 Oct · Blocked']);
  assert.equal(lines[0].extra, true); assert.equal(lines[1].extra, false);
  const mirror = [rows[0], { status: 'blocked', checkin_date: '2026-10-08', checkout_date: '2026-10-11', block_label: 'Airbnb copy' }];
  assert.deepEqual(CS.blockedLines(mirror, '2026-10-08').map(CS.blockedLineText), ['8 Oct to 10 Oct · Airbnb copy · same nights as the stay']);
  const before = [rows[0], { status: 'blocked', checkin_date: '2026-10-06', checkout_date: '2026-10-09', block_label: 'Owner' }];
  assert.deepEqual(CS.blockedLines(before, '2026-10-01').map(CS.blockedLineText), ['6 Oct to 7 Oct · Owner · two nights before check-in']);
  assert.equal(CS.blockedLines(rows, '2026-10-20').length, 0, 'past blocks drop off');
});

test('tgLink: the app link and the web fallback, with and without a post', () => {
  assert.deepEqual(CS.tgLink('3798341977'), { app: 'tg://privatepost?channel=3798341977&post=1', web: 'https://t.me/c/3798341977/1' }, 'post defaults to 1');
  assert.deepEqual(CS.tgLink('3819352746', 12), { app: 'tg://privatepost?channel=3819352746&post=12', web: 'https://t.me/c/3819352746/12' });
  assert.equal(CS.tgLink('-100123"x', '7x').app, 'tg://privatepost?channel=100123&post=7', 'only digits survive');
});

test('warning info: plain meaning, the right place to fix it, and who may mark it handled', () => {
  const v = (title, status) => ({ kind: 'verifier', severity: 'alert', title, detail: { check_id: 'V1', status: status || 'open' } });
  const ov = CS.warningInfo(v('Two stays overlap'), 'admin');
  assert.match(ov.meaning, /share at least one night/); assert.match(ov.go.href, /#\/bookings\/calendar$/); assert.equal(ov.resolvable, true);
  assert.match(CS.warningInfo(v('Duplicate ledger rows'), 'owner').go.href, /#\/finance\/transactions$/);
  assert.match(CS.warningInfo(v('Checkout with no cleaning logged'), 'owner').go.href, /#\/operations$/);
  const id = CS.warningInfo(v('Arriving soon with no ID on file'), 'cleaner');
  assert.deepEqual([id.go.href, id.go.external, id.resolvable], ['#calendar/next', false, false]);
  assert.equal(CS.warningInfo(v('Two stays overlap'), 'cleaner').go, null, 'no dashboard jump for staff');
  assert.equal(CS.warningInfo(v('Two stays overlap', 'acknowledged'), 'admin').resolvable, false);
  assert.equal(CS.warningInfo(v('Two stays overlap'), 'finance').resolvable, false, 'ack is owner/admin only');
  const v1m = CS.warningInfo({ kind: 'verifier', title: 'Airbnb block runs past the direct stay', key: 'V1m:x', acknowledged: false,
    detail: { check_id: 'V1m', status: 'open' }, facts: { ref: 'BD296460', guest_first: 'Ana', from: '2026-10-08', to: '2026-10-11', block_from: '2026-10-08', block_to: '2026-10-12' } }, 'admin');
  assert.match(v1m.meaning, /covers nights with no guest/); assert.match(v1m.go.href, /#\/bookings\/calendar$/);
  assert.deepEqual(v1m.details.slice(1, 5), ['Guest: Ana', 'Booking BD296460', 'Stay: 8 Oct to 11 Oct', 'Calendar block: 8 Oct to 12 Oct']);
  assert.ok(CS.warningInfo({ kind: 'verifier', title: 'Duplicate ledger rows', detail: { check_id: 'V10' }, facts: { check: 'ledger_duplicates', n: 2 } }, 'owner').details.includes('2 cases found'));
  assert.equal(CS.warningInfo({ ...v('Two stays overlap'), acknowledged: true }, 'admin').resolvable, false);
  const inv = CS.warningInfo({ kind: 'inventory', title: 'Low stock: Soap', detail: { qty: 1, unit: 'pc', reorder_below: 10 } }, 'admin');
  assert.match(inv.go.href, /#\/inventory$/); assert.deepEqual(inv.details, ['Soap, 1 pc (reorder below 10)']);
  const bo = CS.warningInfo({ kind: 'brownout', title: 'SOCOTECO II', detail: { date: '2026-10-15', time: '06:00', hours: 11 } }, 'admin');
  assert.equal(bo.resolvable, false); assert.match(bo.head, /^Brownout Thu 15 Oct/);
});

test('finding key: from the warning, else the single matching Tasks row', () => {
  const w = { kind: 'verifier', title: 'Two stays overlap', detail: {} };
  assert.equal(CS.findingKey({ ...w, key: 'k0' }, []), 'k0');
  const tasks = [{ source: 'verifier_findings', id: 'k1', title: 'Two stays overlap', status: 'open' }, { source: 'follow_up_tasks', id: 'x', title: 'Two stays overlap', status: 'open' }];
  assert.equal(CS.findingKey(w, tasks), 'k1');
  assert.equal(CS.findingKey(w, tasks.concat([{ source: 'verifier_findings', id: 'k2', title: 'Two stays overlap', status: 'open' }])), null, 'two matches: no guess');
  assert.equal(CS.findingKey(w, null), null);
  const wc = { ...w, detail: { check_id: 'V1' } };
  const keyed = [{ source: 'verifier_findings', id: 'V1:a:b', title: 'Two stays overlap', status: 'open' }, { source: 'verifier_findings', id: 'V3:c', title: 'Two stays overlap', status: 'open' }];
  assert.equal(CS.findingKey(wc, keyed), 'V1:a:b', 'the check id must match the key prefix');
  assert.equal(CS.findingKey({ ...wc, key: 'V1:z' }, keyed), 'V1:z', 'w.key wins');
});

test('rpc missing and day-flag roles', () => {
  assert.equal(CS.rpcMissing({ code: 'PGRST202' }), true);
  assert.equal(CS.rpcMissing({ status: 404 }), true);
  assert.equal(CS.rpcMissing({ code: '42501' }), false);
  assert.equal(CS.rpcMissing(null), false);
  assert.deepEqual(['owner', 'admin', 'finance', 'cleaner'].map(CS.canFlagDays), [true, true, false, false]);
});

test('guest contact: what to show, a safe Messenger link, and the contact guard scoped to owner/admin guest cards', () => {
  assert.equal(CS.guestContact({}), null); assert.equal(CS.guestContact(null), null);
  assert.deepEqual(CS.guestContact({ phone: ' 0917-123-4567 ', email: '' }), { phone: '0917-123-4567', tel: 'tel:09171234567', email: null, messenger: null });
  assert.equal(CS.guestContact({ phone: 'n/a' }).tel, null, 'no dial link without digits');
  assert.equal(CS.guestContact({ messenger: { thread_url: 'javascript:alert(1)' } }).messenger, CS.MESSENGER_INBOX);
  assert.equal(CS.guestContact({ messenger: { thread_url: 'https://m.me/x' } }).messenger, 'https://m.me/x');
  const p = { current_guest: { phone: '1', email: 'e' }, next_guest: { phone: '2' } };
  assert.equal(CS.assertNoMoney(p, { allowContact: true }), true);
  assert.throws(() => CS.assertNoMoney(p), /contact keys/);
  assert.throws(() => CS.assertNoMoney({ current_guest: { phone: '1', amount: 5 } }, { allowContact: true }), /amount/, 'money is never allowed');
  assert.throws(() => CS.assertNoMoney({ calendar: [{ phone: '1' }] }, { allowContact: true }), /phone/, 'contact only on the guest cards');
  assert.deepEqual(['owner', 'admin', 'finance', 'cleaner'].map(CS.canSeeGuestContact), [true, true, false, false]);
});

// s78 (D-320): a stay shows through its checkout day; same guest on two rows = one stay; turnover and clash days.
test('stay span: arrival day, nights, and the checkout day are all marked', () => {
  const s = (iso) => CS.dayStatus(iso, rows, [], []);
  const d8 = s('2026-10-08'), d10 = s('2026-10-10'), d11 = s('2026-10-11'), d12 = s('2026-10-12');
  assert.deepEqual([d8.primary, d8.arrive, d8.out, d8.turnover], ['booked', true, null, false]);
  assert.equal(CS.dayMoves(d8), 'Angeleen arrives');
  assert.deepEqual([d10.primary, d10.arrive, d10.cont], ['booked', false, false], 'the last night');
  assert.equal(d11.out.guest_name, 'Angeleen', 'the checkout day is marked');
  assert.equal(d11.primary, 'blocked', 'the night after checkout keeps its own status (the mirror block)');
  assert.equal(CS.dayMoves(d11), 'Angeleen checks out');
  assert.equal(d12.out, null);
});

test('same guest on overlapping or chained rows is one stay, labelled by the paid channel', () => {
  const two = [
    { uid: 'a', status: 'confirmed', guest_name: 'Bianca', source: 'airbnb', checkin_date: '2026-08-22', checkout_date: '2026-08-23' },
    { uid: 'b', status: 'confirmed', guest_name: 'Bianca', source: 'airbnb', checkin_date: '2026-08-23', checkout_date: '2026-08-24' },
    { uid: 'c', status: 'confirmed', guest_name: 'Ana Reyes', source: 'airbnb', checkin_date: '2026-10-08', checkout_date: '2026-10-11' },
    { uid: 'd', status: 'confirmed', guest_name: 'ana', source: 'direct', checkin_date: '2026-10-08', checkout_date: '2026-10-10' },
    { uid: 'e', status: 'cancelled', guest_name: 'Ana', source: 'direct', checkin_date: '2026-10-01', checkout_date: '2026-10-30' }
  ];
  const st = CS.mergeStays(two);
  assert.equal(st.length, 2);
  assert.deepEqual([st[0].checkin_date, st[0].checkout_date, st[0].nights, st[0].rows.length], ['2026-08-22', '2026-08-24', 2, 2], 'chained rows join');
  assert.deepEqual([st[1].uid, st[1].source, st[1].checkout_date, st[1].rows.length], ['d', 'direct', '2026-10-11', 2], 'direct wins the label, the span covers both');
  assert.equal(CS.dayStatus('2026-08-23', two, [], []).turnover, false, 'no turnover inside one guest');
  assert.equal(CS.dayStatus('2026-10-09', two, [], []).clash.length, 0, 'no clash for one guest on two channels');
  assert.equal(CS.sameGuest({ guest_name: 'Bia' }, { guest_name: 'Bianca' }), false, 'a prefix of a word is not the same name');
  assert.equal(CS.sameGuest({ guest_name: 'Jose' }, { guest_name: 'Jose Cruz' }), true);
  assert.equal(CS.sameGuest({ guest_name: '' }, { guest_name: '' }), false, 'no name never merges');
});

test('turnover: one guest out and another in the same day; a true overlap of two guests is a clash', () => {
  const t = [
    { uid: 'x', status: 'confirmed', guest_name: 'Dex', source: 'airbnb', checkin_date: '2026-08-18', checkout_date: '2026-08-21' },
    { uid: 'y', status: 'confirmed', guest_name: 'Ale', source: 'airbnb', checkin_date: '2026-08-21', checkout_date: '2026-08-22' },
    { uid: 'z', status: 'confirmed', guest_name: 'Rey', source: 'direct', checkin_date: '2026-08-21', checkout_date: '2026-08-23' }
  ];
  const d21 = CS.dayStatus('2026-08-21', t.slice(0, 2), [], []);
  assert.deepEqual([d21.turnover, d21.out.guest_name, d21.stay.guest_name], [true, 'Dex', 'Ale']);
  assert.notEqual(d21.out.tone, d21.stay.tone, 'the two halves differ');
  assert.equal(CS.dayMoves(d21), 'Dex checks out, Ale arrives');
  const c = CS.dayStatus('2026-08-21', t, [], []);
  assert.equal(c.clash.length, 1, 'two different guests on one night');
  assert.equal(CS.dayMoves(c), 'Dex checks out, Ale arrives, Rey arrives', 'the clashing arrival is said too');
  assert.equal(CS.dayStatus('2026-08-20', t, [], []).clash.length, 0);
});

test('a merge never hides a turnover or a clash', () => {
  const chained = [
    { uid: 'a', status: 'confirmed', guest_name: 'Jose', source: 'airbnb', checkin_date: '2026-09-25', checkout_date: '2026-09-27' },
    { uid: 'b', status: 'confirmed', guest_name: 'Jose Cruz', source: 'airbnb', checkin_date: '2026-09-27', checkout_date: '2026-09-28' }
  ];
  assert.equal(CS.mergeStays(chained).length, 2, 'chained rows join only on the exact same name');
  assert.equal(CS.dayStatus('2026-09-27', chained, [], []).turnover, true, 'so the turnover still shows');
  const oneChannel = [
    { uid: 'c', status: 'confirmed', guest_name: 'Mia', source: 'airbnb', checkin_date: '2026-10-01', checkout_date: '2026-10-03' },
    { uid: 'd', status: 'confirmed', guest_name: 'Mia', source: 'airbnb', checkin_date: '2026-10-02', checkout_date: '2026-10-04' }
  ];
  assert.equal(CS.mergeStays(oneChannel).length, 2, 'two rows from one channel on the same night are not one stay');
  assert.equal(CS.dayStatus('2026-10-02', oneChannel, [], []).clash.length, 1, 'they show as a clash');
  const mirror = [oneChannel[0], { ...oneChannel[1], uid: 'e', source: 'direct', guest_name: 'Mia Santos' }];
  assert.equal(CS.mergeStays(mirror).length, 1, 'a direct booking and its Airbnb copy are one stay');
});
