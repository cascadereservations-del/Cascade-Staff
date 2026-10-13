// Lane C: the paid sentences (same golden strings as the Edge Function's paid.test.ts), the home-screen notice, and the Your requests steps.
// Frozen clock: every "now" below is a fixed number. The notice talks to a mock that asserts the exact RPC name.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { FakeEl, fire, plain, target } from './C_dom-harness.mjs';
const req = createRequire(import.meta.url);
const T = req('../pay/C_paid-text.js');
const N = req('../pay/C_paid-notice.js');

const NOW = Date.parse('2026-10-15T09:00:00Z');
const REQ = { first_name: 'Honey', total: 1235, date_from: '2026-10-10', date_to: '2026-10-12', bank_reference: '12345678', bank_label: 'MariBank', ref: 'ABCD1234', paid_at: '2026-10-15T07:12:00Z', status: 'paid' };

test('golden sentences: push, notice and home line are exactly the approved wording', () => {
  assert.equal(T.pushTitle, 'Your payment has been sent');
  assert.equal(T.pushBody(REQ), 'Hi Honey, your pay for Oct 10 to Oct 12 is on its way to your MariBank account. Open Cascade Staff for the details. Thank you for your care with the house.');
  assert.equal(T.noticeText(REQ), 'Hi Honey, we have sent PHP 1,235 to your MariBank account for your work on Oct 10 to Oct 12. Reference: 1234 5678. Please let us know if anything looks different on your side. Thank you for your care with the house. Marifel & The Cascade Team');
  assert.equal(T.homeLine(REQ), 'Paid PHP 1,235 · Oct 15 · ref …5678');
  assert.doesNotMatch(T.pushBody(REQ) + T.noticeText(REQ), /!/);
  assert.doesNotMatch(T.pushBody(REQ), /PHP|₱|1,?235|5678/, 'no amount and no reference on the lock screen');
});

test('edge cases: one day, cents, no bank label, no bank reference, a paid time late in the Manila evening', () => {
  assert.equal(T.range('2026-10-10', '2026-10-10'), 'Oct 10'); assert.equal(T.range(null, null), '');
  assert.equal(T.php(1235.5), 'PHP 1,235.50'); assert.equal(T.php(40), 'PHP 40'); assert.equal(T.php('1000'), 'PHP 1,000');
  const bare = { first_name: 'Honey', total: 40, date_from: '2026-10-10', date_to: '2026-10-10', bank_reference: null, bank_label: null, ref: 'ABCD1234', paid_at: '2026-10-15T17:30:00Z' };
  assert.equal(T.noticeText(bare), 'Hi Honey, we have sent PHP 40 to your account for your work on Oct 10. Reference: CASCADE-ABCD1234. Please let us know if anything looks different on your side. Thank you for your care with the house. Marifel & The Cascade Team');
  assert.equal(T.homeLine(bare), 'Paid PHP 40 · Oct 16 · ref …1234', '17:30 UTC is already the next day in Manila');
  assert.equal(T.reference({ bank_reference: 'ab12-3456 789' }), 'ab12 3456 789');
});

test('steps: Requested -> Paying -> Paid with a state each; cancelled is its own word', () => {
  assert.deepEqual(plain(T.steps('requested').steps.map((s) => s.state)), ['now', 'next', 'next']);
  assert.deepEqual(plain(T.steps('paying').steps.map((s) => s.state)), ['done', 'now', 'next']);
  assert.deepEqual(plain(T.steps('paid').steps.map((s) => s.state)), ['done', 'done', 'now']);
  assert.deepEqual(plain(T.steps('paid').steps.map((s) => s.label)), ['Requested', 'Paying', 'Paid']);
  assert.equal(T.steps('cancelled').cancelled, true);
});

function mountWith(rows, o = {}) {
  const el = new FakeEl('slot'); el.hidden = true; const calls = [];
  const client = { rpc: async (name, args) => { calls.push([name, args]); return o.res || { data: { ok: true, requests: rows }, error: null }; } };
  const store = {}; const storage = o.storage === undefined ? { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } } : o.storage;
  return { el, calls, store, run: () => N.mount(el, { client, now: () => NOW, storage, demo: o.demo }) };
}

test('notice: asks staff_pay_my_requests_v1 (no arguments), shows the newest paid request with the exact wording, and unhides the slot', async () => {
  const older = { ...REQ, ref: 'OLD00001', paid_at: '2026-10-13T02:00:00Z' };
  const m = mountWith([{ ...REQ, status: 'paying', ref: 'PAY00001', paid_at: null }, older, REQ]);
  const shown = await m.run();
  assert.equal(m.calls.length, 1); assert.equal(m.calls[0][0], 'staff_pay_my_requests_v1'); assert.equal(m.calls[0][1], undefined);
  assert.equal(shown.ref, 'ABCD1234'); assert.equal(m.el.hidden, false);
  assert.match(m.el.innerHTML, /You were paid/); assert.match(m.el.innerHTML, /Paid PHP 1,235 · Oct 15 · ref …5678/);
  assert.match(m.el.innerHTML, /Hi Honey, we have sent PHP 1,235 to your MariBank account for your work on Oct 10 to Oct 12\. Reference: 1234 5678\./);
  assert.match(m.el.innerHTML, /Marifel &amp; The Cascade Team/);
});

test('notice: OK dismisses it for that ref only; storage that throws never breaks it', async () => {
  const m = mountWith([REQ]); await m.run();
  await fire(m.el, 'click', { target: target({ 'data-C-ok': 'ABCD1234' }) });
  assert.equal(m.el.hidden, true); assert.equal(m.store.C_paid_seen, 'ABCD1234');
  const again = mountWith([REQ]); again.store.C_paid_seen = 'ABCD1234'; assert.equal(await again.run(), null); assert.equal(again.el.hidden, true);
  const newer = mountWith([{ ...REQ, ref: 'NEW00002' }]); newer.store.C_paid_seen = 'ABCD1234'; assert.equal((await newer.run()).ref, 'NEW00002');
  const bad = mountWith([REQ], { storage: { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } } });
  assert.equal((await bad.run()).ref, 'ABCD1234'); await fire(bad.el, 'click', { target: target({ 'data-C-ok': 'ABCD1234' }) }); assert.equal(bad.el.hidden, true);
});

test('notice: hidden when nothing is paid, older than 7 days, the RPC is absent, denied, offline or throws; never an error state', async () => {
  for (const rows of [[], [{ ...REQ, status: 'requested' }], [{ ...REQ, paid_at: '2026-10-07T08:59:00Z' }]]) { const m = mountWith(rows); assert.equal(await m.run(), null); assert.equal(m.el.hidden, true); }
  assert.equal(N.pick([{ ...REQ, paid_at: '2026-10-08T09:00:01Z' }], NOW, null).ref, 'ABCD1234', 'just inside seven days');
  for (const res of [{ data: null, error: { code: 'PGRST202' } }, { data: { ok: false, reason: 'not_authorized' }, error: null }, { data: null, error: { code: '08006' } }]) { const m = mountWith([], { res }); assert.equal(await m.run(), null); assert.equal(m.el.hidden, true); assert.equal(m.el.innerHTML, ''); }
  const el = new FakeEl('s'); assert.equal(await N.mount(el, { client: { rpc: () => { throw new Error('boom'); } }, now: () => NOW }), null); assert.equal(el.hidden, true);
  assert.equal(await N.mount(null, {}), null);
});

test('notice: demo shows synthetic data with no network call', async () => {
  const el = new FakeEl('s'); el.hidden = true;
  const shown = await N.mount(el, { demo: true, now: () => NOW });
  assert.equal(shown.ref, 'DEMO0001'); assert.equal(el.hidden, false); assert.match(el.innerHTML, /Paid PHP 1,235/);
});
