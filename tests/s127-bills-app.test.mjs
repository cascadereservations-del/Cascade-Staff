// s127 lane U: the To pay list on Today and the pure helpers of the bills screens. Names are invented ("Zz"); amounts are worked out by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { CS, read, boot, baseHandlers } from './_a_harness.mjs';

const win = { CS, ICON: (n) => '<svg data-i="' + n + '"></svg>' }; win.window = win;
vm.runInContext(read('bills/BL_bills.js'), vm.createContext(win));
const L = win.BL_Bills.lib;
const plain = (x) => JSON.parse(JSON.stringify(x));
const BASE = { since: '2026-10-21', last_reading_at: '2026-10-14T02:00:00Z', electric: { php: 4314.35, kwh: 383 }, water: { php: 212, m3: 7.2 } };
const E = (o) => CS.billsToday(Object.assign({}, BASE, { due: [Object.assign({ id: 'b1', kind: 'internet', label: 'Internet', status: 'due', estimate_php: 1500, is_estimate: false, due_day: 28, can_pay: true }, o)] })).due[0];
const ctx = { today: '2026-11-20', last: '2026-11-19', mayProof: true };

test('billRow: due, estimate, paying sub-lines', () => {
  assert.equal(CS.billRow(E({}), ctx).sub, 'due 28th');
  assert.equal(CS.billRow(E({}), ctx).amount, '₱1,500');
  assert.equal(CS.billRow(E({}), ctx).action, 'pay');
  assert.match(CS.billRow(E({ is_estimate: true, estimate_php: 2140.5 }), ctx).sub, /^est\. to 19 Nov · due 28th$/);
  assert.equal(CS.billRow(E({ is_estimate: true, estimate_php: 2140.5 }), ctx).amount, '₱2,140.50');
  assert.equal(CS.billRow(E({ status: 'paying', paying_by_name: 'Zz Ana', can_pay: false }), ctx).sub, 'Zz Ana is paying this now');
  assert.equal(CS.billRow(E({ status: 'paying', paying_by_name: 'Zz Ana', can_pay: false }), ctx).action, '');
  assert.equal(CS.billRow(E({ status: 'paying', can_pay: true }), ctx).sub, 'You are paying this now');
});
test('billRow: a paid row opens the proof only for those who may see it', () => {
  const paid = E({ status: 'paid', paid_php: 449, paid_by_name: 'Zz Ben', paid_at: '2026-11-20T03:00:00Z', can_pay: false });
  assert.equal(CS.billRow(paid, ctx).sub, 'Paid ₱449 · today · Zz Ben');
  assert.equal(CS.billRow(paid, ctx).action, 'proof');
  assert.equal(CS.billRow(paid, { today: '2026-11-20', mayProof: false }).action, '');
  assert.equal(CS.billRow(E({ status: 'paid', paid_php: 12345, can_pay: false }), ctx).sub, 'Paid ₱12,345');
});
test('billsMayPay: owner, admin, finance only', () => {
  for (const r of ['owner', 'admin', 'finance']) assert.equal(CS.billsMayPay(r), true);
  for (const r of ['cleaner', 'laundry', '', undefined]) assert.equal(CS.billsMayPay(r), false);
});
test('billsToday: no due key gives an empty list, junk entries are dropped', () => {
  assert.deepEqual(plain(CS.billsToday(BASE).due), []);
  assert.deepEqual(plain(CS.billsToday(Object.assign({}, BASE, { due: [null, 5] })).due), []);
});

test('refusal: every reason in the contract has its own sentence', () => {
  const reasons = ['not_authorized', 'not_found', 'already_paid', 'paying_by_other', 'not_payer', 'bad_proof', 'no_stored_proof', 'sha_mismatch', 'duplicate_proof', 'bad_amount', 'no_proof', 'bad_kind', 'bad_patch', 'bad_key', 'bad_value'];
  const unknown = L.refusal({ reason: 'zzz' });
  for (const reason of reasons) { const s = L.refusal({ reason, name: 'Zz Cy', key: 'amount_php' }); assert.ok(s.length > 10, reason); assert.notEqual(s, unknown, reason); }
  assert.equal(L.refusal({ reason: 'paying_by_other', name: 'Zz Cy' }), 'Zz Cy is paying this now.');
  assert.equal(L.refusal({ reason: 'confirm_amount', read: 9000, estimate_php: 2000 }), '₱9,000 is well above the estimate of ₱2,000. Check the receipt, then tap Mark as paid again to log it.');
  assert.match(L.refusal({ reason: 'confirm_amount', read: 100, estimate_php: 2000 }), /well below/);
});
test('refusal: unknown and network failures say it may not be logged; the edit screen says nothing was saved', () => {
  assert.equal(L.refusal({ reason: 'weird' }), 'This may not be logged yet. Check the card before paying again.');
  assert.equal(L.refusal(null), 'This may not be logged yet. Check the card before paying again.');
  assert.equal(L.refusal({ reason: 'weird' }, { edit: true }), 'Nothing was saved. Check your connection and try again.');
  assert.deepEqual(plain(L.failure({ code: '55000', message: 'Plain sentence.' })), { ok: false, sentence: 'Plain sentence.' });
  assert.equal(L.failure({ code: '500' }).reason, 'unknown');
});
test('amountOf, payReady, proofPayload', () => {
  assert.equal(L.amountOf('1,234.50'), 1234.5); assert.equal(L.amountOf(' 449 '), 449);
  for (const bad of ['', '0', '-5', '12.345', 'abc', null]) assert.equal(L.amountOf(bad), null, String(bad));
  assert.equal(L.payReady({ file: null, amountText: '10' }), false);
  assert.equal(L.payReady({ file: {}, amountText: '0' }), false);
  assert.equal(L.payReady({ file: {}, amountText: '10', busy: true }), false);
  assert.equal(L.payReady({ file: {}, amountText: '10' }), true);
  const up = { path: 'p/x.jpg', sha256: 'a'.repeat(64) };
  assert.equal(L.proofPayload(up, 9000, null).confirmed, false);
  assert.equal(L.proofPayload(up, 9000, 9000).confirmed, true);
  assert.equal(L.proofPayload(up, 9100, 9000).confirmed, false); // a changed amount must be confirmed again
  assert.deepEqual(plain(L.proofPayload(up, 449, null)), { path: 'p/x.jpg', sha256: up.sha256, amount: 449, confirmed: false });
});
test('changedKeys: only what changed, numbers as numbers, text trimmed', () => {
  const orig = { payee_name: 'Zz Power Co', number: '123', note: 'Electricity', amount_php: 1500, remind_day: 27 };
  assert.deepEqual(plain(L.changedKeys(orig, { payee_name: ' Zz Power Co ', number: '123', note: 'Electricity', amount_php: '1,500', remind_day: '27' })), {});
  assert.deepEqual(plain(L.changedKeys(orig, { payee_name: 'Zz Grid Co', amount_php: '1,650.50', remind_day: '25' })), { payee_name: 'Zz Grid Co', amount_php: 1650.5, remind_day: 25 });
});

// the live path: the real shell draws the card from today_bills_v1
const todayHtml = async (role, due) => { const app = await boot({ role, hash: '#home', handlers: baseHandlers(role, { today_bills_v1: () => ({ error: null, data: { since: '2026-10-21', last_reading_at: '2026-10-14T02:00:00Z', electric: { php: 4314.35, kwh: 383 }, water: { php: 212, m3: 7.2 }, due } }) }) }); return app.els['v-home'].innerHTML; };
const DUE = [{ id: 'b1', kind: 'internet', label: 'Internet', status: 'due', estimate_php: 1500, is_estimate: false, due_day: 28, can_pay: true },
  { id: 'b2', kind: 'netflix', label: 'Subscription', status: 'paid', estimate_php: 449, paid_php: 449, paid_by_name: 'Zz Ben', paid_at: '2026-11-20T03:00:00Z', can_pay: false }];
test('Today card: owner gets the Pay link and a tappable paid row; cleaner gets neither', async () => {
  const o = await todayHtml('owner', DUE);
  assert.ok(o.includes('href="#bills/pay/b1"')); assert.ok(o.includes('data-act="bill-proof"')); assert.ok(o.includes('₱1,500')); assert.ok(o.includes('This bill so far'));
  const c = await todayHtml('cleaner', [Object.assign({}, DUE[0], { can_pay: false }), DUE[1]]);
  assert.ok(!c.includes('#bills/pay/')); assert.ok(!c.includes('data-act="bill-proof"')); assert.ok(c.includes('Internet'));
});
test('Today card: no due list draws no To pay link', async () => {
  const h = await todayHtml('owner', []); assert.ok(!h.includes('#bills/pay/')); assert.ok(h.includes('T_bills'));
});
