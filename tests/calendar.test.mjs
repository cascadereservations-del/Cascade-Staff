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
