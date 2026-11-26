// s143 lane B: the bill pay form in the Inventory Update skin (frames 6 and 7), driven through its real handlers with the orchestrator's fixtures.
// Every expected value below is worked out by hand. Names and numbers come from tests/fixtures/s143_pay_open.json (fictional).
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { CS, read } from './_a_harness.mjs';
import { createRequire } from 'node:module';

const FX = createRequire(import.meta.url)('./fixtures/s143_pay_open.json');
const win = { CS, ICON: (n) => '<svg data-i="' + n + '"></svg>' }; win.window = win;
vm.runInContext(read('bills/BL_bills.js'), vm.createContext(win));
const BL = win.BL_Bills, L = BL.lib;
const plain = (x) => JSON.parse(JSON.stringify(x));
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };
const clone = (x) => JSON.parse(JSON.stringify(x));

async function sheet(rpc) {
  const h = {}, nodes = { '#BL_done': { disabled: false, textContent: '' }, '#BL_amthelp': { textContent: '' }, '#BL_file': { click() {} }, '#BL_cam': { click() {} }, '[data-i-flow]': { innerHTML: '' }, '[data-i-confirm]': { innerHTML: '' }, '[data-i-covers]': { innerHTML: '' } };
  const box = { innerHTML: '', addEventListener: (t, f) => { h[t] = f; }, removeEventListener() {}, querySelector: (s) => nodes[s] || null, querySelectorAll: () => [] };
  const calls = [], st = { changes: 0, box, calls, h, nodes };
  const o = { box, sub: 'pay/b', propertyId: 'p', client: { rpc: (n, a) => { calls.push([n, plain(a)]); return Promise.resolve(rpc(n, a)).then((d) => ({ error: null, data: d })); } }, upload: async (f) => ({ path: 'cleaning/' + f.name, sha256: 'a'.repeat(64) }), onChange() { st.changes++; }, navigate() {}, toast() {} };
  BL.mount(box, o); await flush();
  st.file = async (name) => { h.change({ target: { id: 'BL_file', files: [{ name }] } }); await flush(); };
  st.type = async (id, v) => { h.input({ target: { id, value: v, getAttribute: () => null } }); await flush(); };
  st.click = async (act, data) => { h.click({ target: { closest: (s) => (s === '[data-bact]' ? { getAttribute: (k) => (k === 'data-bact' ? act : k === 'data-v' ? data || null : null) } : null) } }); await flush(); };
  st.bodies = () => calls.filter((c) => c[0] === 'bill_pay_settle_v1').map((c) => c[1].p_proof);
  return st;
}
const serve = (open, settle) => (n) => (n === 'bill_pay_open_v1' ? clone(open) : typeof settle === 'function' ? settle() : settle || { ok: true });

test('BL lib: rangeText is "21 Oct – 21 Nov", with a tilde on an assumed end, and empty when an end is missing', () => {
  assert.equal(L.rangeText('2026-10-21', '2026-11-21', false), '21 Oct – 21 Nov');
  assert.equal(L.rangeText('2026-10-21', '2026-11-21', true), '21 Oct – ~21 Nov');
  assert.equal(L.rangeText(null, '2026-11-21', false), ''); assert.equal(L.rangeText('2026-10-21', '', false), '');
});
test('BL lib: the over-band sentence is worked out from the estimate (above twice, below half, otherwise far from)', () => {
  assert.equal(L.overBandCopy(9100, 4000), '₱9,100 is more than twice the estimate. Check the bill, then confirm.'); // 9100 > 8000
  assert.equal(L.overBandCopy(1500, 4000), '₱1,500 is less than half the estimate. Check the bill, then confirm.'); // 1500 < 2000
  assert.equal(L.overBandCopy(2500, 4000), '₱2,500 is far from the estimate of ₱4,000. Check the bill, then confirm.'); // inside the band, the server still asked
  assert.equal(L.overBandCopy(2500, 0), 'Check the amount on the bill, then confirm.');
});
test('BL lib: readPrefill uses the server date (assumed only when it says so), never after today, and the old default without one', () => {
  assert.deepEqual(plain(L.readPrefill(FX.open.water.bill, '2026-11-26')), { date: '2026-11-21', assumed: false });
  assert.deepEqual(plain(L.readPrefill(FX.open.electric.bill, '2026-11-26')), { date: '2026-11-21', assumed: true });
  assert.deepEqual(plain(L.readPrefill({ ...FX.open.water.bill, reading_date: '2026-12-21', reading_date_assumed: true }, '2026-11-26')), { date: '2026-11-26', assumed: true });
  assert.deepEqual(plain(L.readPrefill(FX.open.old_server_water.bill, '2026-11-26')), { date: '2026-11-21', assumed: false }); // 21st of the billed month
});
test('BL lib: a new server is told by pay.method_default; the old shape is not', () => {
  assert.equal(L.srvNew(FX.open.water), true); assert.equal(L.srvNew(FX.open.old_server_water), false); assert.equal(L.srvNew(null), false);
});
test('BL lib: payReady needs a way paid, a paid-on day that is not after today and not before the reading date', () => {
  const ok = { file: {}, amountText: '212', busy: false, meter: true, readDate: '2026-11-21', readVal: '', today: '2026-11-26', paidOn: '2026-11-25', method: 'gcash', needMethod: true };
  assert.equal(L.payReady(ok), true);
  assert.equal(L.payReady({ ...ok, method: '' }), false); assert.equal(L.payReady({ ...ok, method: 'crypto' }), false);
  assert.equal(L.payReady({ ...ok, paidOn: '2026-11-27' }), false, 'after today');
  assert.equal(L.payReady({ ...ok, paidOn: '2026-11-20' }), false, 'before the reading date 21 Nov');
  assert.equal(L.payReady({ ...ok, paidOn: '2026-11-21' }), true, 'on the reading date is fine');
  const old = { file: {}, amountText: '212', busy: false, meter: true, readDate: '2026-11-21', readVal: '', today: '2026-11-26' }; // an old sheet carries neither
  assert.equal(L.payReady(old), true);
});
test('BL lib: the two new refusals and the reading date refusal with a day are plain sentences', () => {
  assert.equal(L.refusal(FX.settle_refusals.paid_on_invalid), 'The day you paid cannot be after today or before the reading date on the bill. Check the two dates.');
  assert.equal(L.refusal(FX.settle_refusals.bad_method), 'Choose how you paid: GCash, Bank or Cash.');
  assert.equal(L.refusal({ reason: 'reading_date_invalid', after: '2026-11-21' }), 'The reading date must be after 21 Nov, the reading date of the last bill, and not in the future. Check the date on the bill.');
  assert.equal(L.refusal({ reason: 'reading_date_invalid', before: '2026-12-23' }), 'The reading date must be before 23 Dec, the reading date of a later bill that is already paid. Check the date on the bill.');
  for (const r of [{ after: '2026-11-21' }, { before: '2026-12-23' }]) assert.doesNotMatch(L.refusal({ reason: 'reading_date_invalid', ...r }), /20\d\d-\d\d-\d\d/, 'no raw day in a sentence');
});
test('BL lib: the success category follows the kind (CONTRACT)', () => {
  assert.deepEqual(plain(L.CATEGORY), { electric: 'Utilities', water: 'Utilities', internet: 'Internet', netflix: 'Subscription' });
});

test('frame 6: the new form is the I_uform I_hue_cnt skin with Pay to first, the amount, "Matches the estimate", the covers row and the way paid', async () => {
  const s = await sheet(serve(FX.open.water)); const h = s.box.innerHTML;
  assert.match(h, /class="I_uform I_hue_cnt"/); assert.match(h, /class="I_band"/); assert.match(h, /class="I_bsub">Water · Gensan Water District</);
  const at = ['Pay to', 'Amount paid', 'Matches the estimate (₱212).', 'Paid on', 'Reading date on bill', 'This payment covers', 'How you paid', 'Payment screenshot', 'Mark Water paid · ₱212'].map((t) => h.indexOf(t));
  assert.ok(at.every((v, i) => v >= 0 && (i === 0 || v > at[i - 1])), at.join(','));
  assert.match(h, /This payment covers <b>21 Oct – 21 Nov<\/b>/); assert.doesNotMatch(h, /I_flow"/, 'no estimate row while the amount matches');
  assert.match(h, /aria-pressed="true"[^>]*>GCash/); assert.match(h, /class="btn btn-block I_save"[^>]*disabled/, 'no screenshot yet');
  assert.doesNotMatch(h, /BL_rval/, 'the present reading is not asked here (the Reading date form owns it)');
  BL.unmount();
});
test('frame 6: an assumed reading date is labelled assumed and its covers end carries a tilde; typing another amount draws the estimate row', async () => {
  const s = await sheet(serve(FX.open.electric)); let h = s.box.innerHTML;
  assert.match(h, /Reading date on bill \(assumed\)/); assert.match(h, /This payment covers <b>21 Oct – ~21 Nov<\/b>/); assert.match(h, /Assumed from the usual day/);
  assert.equal(s.nodes['[data-i-flow]'].innerHTML, '', 'the amount starts on the estimate: no estimate row');
  await s.type('BL_amt', '4,000'); const flow = s.nodes['[data-i-flow]'].innerHTML; // live update only: the shell of the page is not redrawn
  assert.match(flow, /class="I_flow"/); assert.match(flow, /<b>₱4,269\.51<\/b><small>estimate<\/small>/); assert.match(flow, /<b>₱4,000<\/b><small>you pay<\/small>/);
  await s.type('BL_amt', '4269.51'); assert.equal(s.nodes['[data-i-flow]'].innerHTML, '', 'back on the estimate: the row goes away');
  await s.type('BL_amt', '4,500'); assert.match(s.nodes['[data-i-flow]'].innerHTML, /<b>₱4,500<\/b><small>you pay<\/small>/); await s.type('BL_amt', ''); assert.equal(s.nodes['[data-i-flow]'].innerHTML, '', 'no amount: no row');
  BL.unmount();
});
test('frame 6: Mark paid sends paid_on (today) and method, keeps path sha256 amount confirmed reading_date, and never reading_value', async () => {
  const s = await sheet(serve(FX.open.water)); await s.file('shot.jpg'); await s.click('settle');
  const b = s.bodies(); assert.equal(b.length, 1);
  assert.deepEqual(Object.keys(b[0]).sort(), ['amount', 'confirmed', 'method', 'paid_on', 'path', 'reading_date', 'sha256']);
  assert.equal(b[0].amount, 212); assert.equal(b[0].confirmed, false); assert.equal(b[0].method, 'gcash'); assert.equal(b[0].paid_on, CS.manilaToday()); assert.equal(b[0].reading_date, '2026-11-21');
  assert.match(s.box.innerHTML, /Logged as an expense under Utilities\./);
  BL.unmount();
});
test('frame 6: changing the way paid and the paid-on day changes what is sent', async () => {
  const s = await sheet(serve(FX.open.water)); await s.file('shot.jpg'); await s.click('method', 'cash'); await s.type('BL_paid', '2026-11-22'); await s.click('settle');
  const b = s.bodies()[0]; assert.equal(b.method, 'cash'); assert.equal(b.paid_on, '2026-11-22');
  BL.unmount();
});
test('frame 6: with no default way paid the button stays off until one is chosen', async () => {
  const open = clone(FX.open.water); open.pay.method_default = '';
  const s = await sheet(serve(open)); await s.file('shot.jpg');
  assert.match(s.box.innerHTML, /class="btn btn-block I_save"[^>]*disabled/); await s.click('method', 'bank');
  assert.doesNotMatch(s.box.innerHTML, /class="btn btn-block I_save"[^>]*disabled/);
  BL.unmount();
});
test('frame 7: over the band is an info row from the estimate (not an errbox); the button then says Yes and resends confirmed true', async () => {
  const s = await sheet(serve(FX.open.electric, FX.settle_refusals.confirm_amount)); await s.file('shot.jpg'); await s.type('BL_amt', '9100'); await s.click('settle');
  let h = s.box.innerHTML; assert.match(h, /class="MN_row"/); assert.match(h, /₱9,100 is more than twice the estimate\. Check the bill, then confirm\./); assert.doesNotMatch(h, /errbox/);
  assert.match(h, /Yes, mark Electricity paid · ₱9,100/); assert.doesNotMatch(h, /mark electricity|Mark electricity/);
  await s.click('settle'); assert.deepEqual(s.bodies().map((b) => [b.amount, b.confirmed]), [[9100, false], [9100, true]]);
  BL.unmount();
});
test('frame 7: every refusal is one plain sentence and the typed amount stays', async () => {
  for (const [key, sentence] of [['paid_on_invalid', /cannot be after today or before the reading date/], ['bad_method', /Choose how you paid/], ['already_paid', /already logged as paid/], ['not_payer', /Ben is paying this now/]]) {
    const s = await sheet(serve(FX.open.water, FX.settle_refusals[key])); await s.file('shot.jpg'); await s.type('BL_amt', '210'); await s.click('settle');
    assert.match(s.box.innerHTML, sentence, key); if (/^(paid_on_invalid|bad_method)$/.test(key)) assert.match(s.box.innerHTML, /id="BL_amt"[^>]*value="210"/, key + ' keeps the amount (the form stays open)'); BL.unmount();
  }
  const net = await sheet((n) => { if (n === 'bill_pay_open_v1') return clone(FX.open.water); throw new Error('offline'); });
  await net.file('shot.jpg'); await net.type('BL_amt', '210'); await net.click('settle');
  assert.match(net.box.innerHTML, /This may not be logged yet\. Check the card before paying again\./); BL.unmount();
});
test('finding 7: reading_warn is a boolean: only true draws the plain sentence; a refusal on screen shows d Mon', async () => {
  for (const [w, shown] of [[true, true], [false, false], [null, false], [undefined, false]]) {
    const open = clone(FX.open.electric); const s = await sheet(serve(open, { ok: true, bill_id: 'x', reading_warn: w, category: 'Utilities' })); await s.file('shot.jpg'); await s.click('settle');
    assert.equal(/far from the meter log|Check that it was typed right/.test(s.box.innerHTML), shown, String(w)); BL.unmount();
  }
  const r = await sheet(serve(FX.open.electric, { ok: false, reason: 'reading_date_invalid', after: '2026-11-21' })); await r.file('shot.jpg'); await r.click('settle');
  assert.match(r.box.innerHTML, /must be after 21 Nov, the reading date of the last bill/); assert.doesNotMatch(r.box.innerHTML, /after 2026-/); BL.unmount();
});
test('an old server payload still draws the old sheet and sends no paid_on or method', async () => {
  const s = await sheet(serve(FX.open.old_server_water)); const h = s.box.innerHTML;
  assert.doesNotMatch(h, /I_uform/); assert.match(h, /Mark as paid/); assert.match(h, /id="BL_rdate"/);
  await s.file('shot.jpg'); await s.click('settle'); const b = s.bodies()[0];
  assert.equal('paid_on' in b, false); assert.equal('method' in b, false); assert.equal(b.amount, 212);
  BL.unmount();
});
test('the CSS (R1): bills css defines no MN_ piece (they live once in money/MN_money.css), tokens only', () => {
  const css = read('bills/BL_bills.css').replace(/\/\*[^]*?\*\//g, '');
  assert.doesNotMatch(css, /MN_/); assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/); assert.doesNotMatch(css, /rgba?\(|hsla?\(/);
  const mn = read('money/MN_money.css'); for (const c of ['MN_cnt', 'MN_chips', 'MN_cover', 'MN_covers', 'MN_copy', 'MN_req', 'MN_photo', 'MN_amount']) assert.match(mn, new RegExp('\\.' + c + '\\b'), c);
});
