// s143 lane B: money/MN_money.js, the Log money options (frame 5) and the Reading date form (frame 9). Fake box, fake client; expected values worked out by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { CS, read } from './_a_harness.mjs';

const FX = createRequire(import.meta.url)('./fixtures/s143_pay_open.json').reading_set;
const BILLS = createRequire(import.meta.url)('./fixtures/s143_today_bills_new.json');
const win = { CS, ICON: (n) => '<svg data-i="' + n + '"></svg>' }; win.window = win;
vm.runInContext(read('money/MN_money.js'), vm.createContext(win));
const MN = win.MN_Money, L = MN.lib;
const plain = (x) => JSON.parse(JSON.stringify(x));
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };
const TODAY = CS.manilaToday();

async function screen(sub, rpc = () => ({ ok: true })) {
  const h = {}, nodes = {};
  const box = { innerHTML: '', addEventListener: (t, f) => { h[t] = f; }, removeEventListener() {}, querySelector: (s) => (nodes[s] ||= { disabled: false, textContent: '', innerHTML: '' }), querySelectorAll: () => [] };
  const calls = [], nav = [], st = { box, calls, nav, changes: 0, toasts: [] };
  MN.mount(box, { sub, propertyId: 'prop-1', navigate: (x) => nav.push(x), onChange() { st.changes++; }, toast: (m) => st.toasts.push(m), haptic() {}, payUrl: '',
    client: { rpc: (n, a) => { calls.push([n, plain(a)]); return Promise.resolve(rpc(n, a)).then((d) => ({ error: null, data: d })); } } });
  await flush();
  const node = (a) => ({ closest: (s) => (s === '[data-mact]' ? { getAttribute: (k) => (k === 'data-mact' ? a.act : k === 'data-v' ? a.v || null : k === 'data-id' ? a.id || null : null) } : null) });
  st.click = async (act, extra = {}) => { h.click({ target: node({ act, ...extra }) }); await flush(); };
  st.type = async (id, value) => { h.input({ target: { id, value } }); await flush(); };
  st.rpcs = (name) => calls.filter((c) => c[0] === name).map((c) => c[1]);
  return st;
}

test('MN lib: the reading value is optional, numeric, 0 to 9,999,999 with at most two decimals', () => {
  assert.deepEqual(plain(L.valueOf('')), { ok: true, value: null }); assert.deepEqual(plain(L.valueOf('  ')), { ok: true, value: null });
  assert.deepEqual(plain(L.valueOf('1,234.5')), { ok: true, value: 1234.5 }); assert.equal(L.valueOf('12.345').ok, false); assert.equal(L.valueOf('abc').ok, false); assert.equal(L.valueOf('10000000').ok, false);
});
test('MN lib: readingReady needs a real meter, a real day that is not in the future, a valid value, and not busy', () => {
  const ok = { kind: 'electric', date: '2026-12-19', today: '2026-12-20', valueText: '', busy: false };
  assert.equal(L.readingReady(ok), true); assert.equal(L.readingReady({ ...ok, kind: '' }), false); assert.equal(L.readingReady({ ...ok, kind: 'internet' }), false);
  assert.equal(L.readingReady({ ...ok, date: '2026-12-21' }), false, 'tomorrow'); assert.equal(L.readingReady({ ...ok, date: '2026-02-30' }), false, 'not a day');
  assert.equal(L.readingReady({ ...ok, valueText: 'x' }), false); assert.equal(L.readingReady({ ...ok, busy: true }), false);
});
test('MN lib: the request is exactly the contract call, preview true then false', () => {
  assert.deepEqual(plain(L.readingPayload('P', 'electric', '2026-12-19', '', true)), FX.request.p_preview === true ? { ...FX.request, p_property_id: 'P' } : null);
  assert.deepEqual(plain(L.readingPayload('P', 'water', '2026-12-19', '12,345', false)), { p_property_id: 'P', p_kind: 'water', p_reading_date: '2026-12-19', p_reading_value: 12345, p_preview: false });
});
test('MN lib: refusals are plain sentences (every reason in the contract, and no connection)', () => {
  const R = FX.refusals;
  assert.equal(L.refusal(R.not_authorized), 'Setting reading dates is for the owner, admin and finance.');
  assert.equal(L.refusal(R.bad_kind), 'Choose Electricity or Water.');
  assert.equal(L.refusal(R.reading_date_invalid_after), 'The reading date must be after 21 Nov, the day of the last reading, and not in the future. Check the date on the bill.');
  assert.equal(L.refusal(R.reading_date_invalid_before), 'The reading date must be before 23 Dec, the day of the next reading. Check the date on the bill.');
  assert.equal(L.refusal(R.reading_value_invalid), 'The reading looks wrong. Enter the number on the meter, or leave it empty.');
  assert.equal(L.refusal(R.already_paid), 'This bill is already paid, so its reading date is locked. A correction needs the admin.');
  assert.equal(L.refusal(R.older_bill_open), 'An older bill is still open. Pay or skip it first, then set this reading date.');
  assert.equal(L.refusal({ ok: false, reason: 'unknown' }), 'That did not go through. Check your connection and try again.');
  assert.equal(L.refusal({ ok: false, sentence: 'Server words.' }), 'Server words.');
});
test('MN lib: previewLines reads the preview fixture: covers 21 Nov - 19 Dec, estimate 3,980, next reading ~19 Jan', () => {
  assert.deepEqual(plain(L.previewLines(FX.preview)), [{ k: 'This bill covers', v: '21 Nov – 19 Dec' }, { k: 'Estimate', v: '₱3,980' }, { k: 'Next reading', v: '~19 Jan' }]);
  assert.deepEqual(plain(L.previewLines({ ok: true, from: '2026-11-21', to: '2026-12-19', estimate_php: 0, reading_warn: 'Reading is lower than the last one' })).map((x) => x.k), ['This bill covers', 'Check']);
});
test('MN lib: the start date is the server next reading when it is not in the future, else today; the kind comes from the route', () => {
  assert.deepEqual(plain(L.readingStart({ next_reading: '2026-12-21' }, '2026-12-23')), { date: '2026-12-21', assumed: true });
  assert.deepEqual(plain(L.readingStart({ next_reading: '2026-12-21' }, '2026-12-01')), { date: '2026-12-01', assumed: false });
  assert.deepEqual(plain(L.readingStart(undefined, '2026-12-01')), { date: '2026-12-01', assumed: false });
  assert.equal(L.kindFromSub('reading/water'), 'water'); assert.equal(L.kindFromSub('reading/gas'), ''); assert.equal(L.kindFromSub('reading'), ''); assert.equal(L.kindFromSub(''), '');
});
test('MN lib: payable keeps only rows the person can pay, in order', () => {
  const rows = L.payable(BILLS.A); assert.ok(rows.length >= 1); assert.ok(rows.every((r) => r.id && r.label));
  assert.deepEqual(plain(L.payable({ due: [{ id: 'a', can_pay: false }, { id: 'b', can_pay: true, kind: 'water', label: 'Water', due_day: 27, estimate_php: 212 }] })).map((r) => r.id), ['b']);
  assert.deepEqual(plain(L.payable(null)), []);
});

test('frame 5: Log money has the four options and the Reading date and See all buttons, and goes where each says', async () => {
  const s = await screen(''); const h = s.box.innerHTML;
  for (const t of ['Pay a bill', 'Bought stock', 'Other expense', 'Pay staff', 'Reading date', 'See all']) assert.ok(h.includes(t), t);
  assert.match(h, /I_hue_cnt/); assert.match(h, /I_hue_buy/); assert.match(h, /I_hue_use/); assert.match(h, /class="I_uopt I_hue_use"/); assert.match(h, /class="I_umore"/);
  await s.click('other'); await s.click('stock'); await s.click('all'); await s.click('staff');
  assert.deepEqual(s.nav, ['#expenses/other', '#stock', '#expenses', '#payrates']);
  MN.unmount();
});
test('frame 5: Pay a bill lists the open bills the person can pay and opens the pay form', async () => {
  const s = await screen('', (n) => (n === 'today_bills_v1' ? { ok: true, due: [{ id: 'b1', kind: 'water', label: 'Water (Zz)', can_pay: true, due_day: 27, estimate_php: 212 }, { id: 'b2', kind: 'internet', label: 'Internet', can_pay: false }] } : { ok: true }));
  await s.click('bills'); const h = s.box.innerHTML; assert.match(h, /Water \(Zz\)/); assert.doesNotMatch(h, />Internet</); assert.match(h, /₱212 · due the 27th/);
  await s.click('bill', { id: 'b1' }); assert.equal(s.nav.at(-1), '#bills/pay/b1'); MN.unmount();
  const none = await screen('', (n) => (n === 'today_bills_v1' ? { ok: true, due: [] } : { ok: true })); await none.click('bills');
  assert.match(none.box.innerHTML, /No bills are waiting to be paid right now\./); MN.unmount();
});
test('frame 9: the form previews first (p_preview true, nothing saved), then saves (p_preview false) and says what it covers', async () => {
  const s = await screen('reading/electric', (n, a) => (n === 'bill_reading_set_v1' ? (a.p_preview ? FX.preview : FX.saved) : { ok: true, electric: { next_reading: '2026-11-19' } }));
  assert.match(s.box.innerHTML, /Reading date/); assert.match(s.box.innerHTML, /Electricity meter/); assert.match(s.box.innerHTML, /See the estimate/);
  await s.type('MN_date', '2026-11-19'); await s.click('go');
  assert.deepEqual(s.rpcs('bill_reading_set_v1'), [{ p_property_id: 'prop-1', p_kind: 'electric', p_reading_date: '2026-11-19', p_reading_value: null, p_preview: true }]);
  assert.match(s.box.innerHTML, /21 Nov – 19 Dec/); assert.match(s.box.innerHTML, /₱3,980/); assert.match(s.box.innerHTML, /Save reading date/); assert.equal(s.changes, 0, 'a preview changes nothing on Today');
  await s.click('go'); assert.equal(s.rpcs('bill_reading_set_v1').length, 2); assert.equal(s.rpcs('bill_reading_set_v1')[1].p_preview, false);
  assert.match(s.box.innerHTML, /Saved\. Electricity now runs 21 Nov – 19 Dec, about ₱3,980\./); assert.equal(s.changes, 1); assert.deepEqual(s.toasts, ['Reading date saved']);
  MN.unmount();
});
test('frame 9: changing the date after a preview throws the preview away, so a save is always of what is on screen', async () => {
  const s = await screen('reading/water', (n, a) => (n === 'bill_reading_set_v1' ? FX.preview : { ok: true }));
  await s.type('MN_date', '2026-11-19'); await s.click('go'); assert.match(s.box.innerHTML, /Save reading date/);
  await s.type('MN_date', '2026-11-18'); await s.click('go'); const r = s.rpcs('bill_reading_set_v1'); assert.deepEqual(r.map((x) => [x.p_reading_date, x.p_preview]), [['2026-11-19', true], ['2026-11-18', true]]);
  MN.unmount();
});
test('frame 9: a refusal is one plain sentence and the typed date and reading stay', async () => {
  const s = await screen('reading/water', (n) => (n === 'bill_reading_set_v1' ? FX.refusals.reading_date_invalid_after : { ok: true }));
  await s.type('MN_date', '2026-11-20'); await s.type('MN_val', '4,321'); await s.click('go'); const h = s.box.innerHTML;
  assert.match(h, /The reading date must be after 21 Nov, the day of the last reading/); assert.match(h, /id="MN_date"[^>]*value="2026-11-20"/); assert.match(h, /id="MN_val"[^>]*value="4,321"/); assert.doesNotMatch(h, /Saved\./);
  MN.unmount();
  const net = await screen('reading/water', (n) => { if (n === 'bill_reading_set_v1') throw new Error('offline'); return { ok: true }; });
  await net.type('MN_date', '2026-11-20'); await net.click('go'); assert.match(net.box.innerHTML, /That did not go through\. Check your connection and try again\./); MN.unmount();
});
test('frame 9: no meter chosen means the button is off until Electricity or Water is picked; the start date is labelled assumed when it is the server guess', async () => {
  const s = await screen('reading', (n) => (n === 'today_bills_v1' ? { ok: true, water: { next_reading: '2026-10-01' } } : { ok: true }));
  assert.match(s.box.innerHTML, /id="MN_go"[^>]*disabled/); await s.click('kind', { v: 'water' });
  assert.match(s.box.innerHTML, /Reading date on the bill \(assumed\)/); assert.match(s.box.innerHTML, /id="MN_date"[^>]*value="2026-10-01"/); assert.doesNotMatch(s.box.innerHTML, /id="MN_go"[^>]*disabled/);
  assert.equal(TODAY >= '2026-10-01', true); MN.unmount();
});
test('an unknown sub-route goes back to #money; no client says so in a sentence', async () => {
  const s = await screen('nonsense'); assert.deepEqual(s.nav, ['#money']); MN.unmount();
  const box = { innerHTML: '', addEventListener() {}, removeEventListener() {}, querySelector: () => null }; MN.mount(box, { sub: '', navigate() {} }); assert.match(box.innerHTML, /Money needs a connection/); MN.unmount();
});
test('MN_money.css owns the MN_ pieces with tokens only, scoped to #v-money', () => {
  const css = read('money/MN_money.css').replace(/\/\*[^]*?\*\//g, '');
  for (const c of ['MN_cnt', 'MN_chips', 'MN_cover', 'MN_covers', 'MN_copy', 'MN_req', 'MN_photo', 'MN_amount']) assert.match(css, new RegExp('#v-money \\.' + c + '\\b'), c);
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/); assert.doesNotMatch(css, /rgba?\(|hsla?\(/); assert.doesNotMatch(css, /font-size:\s*[\d.]+px/);
});
test('hygiene: plain script, one global, no eval or network of its own, no real names or numbers', () => {
  const src = read('money/MN_money.js'); assert.doesNotThrow(() => new vm.Script(src)); assert.doesNotMatch(src, /\beval\(|new Function|document\.write|fetch\(|XMLHttpRequest|localStorage/);
  assert.doesNotMatch(src, /\b09\d{9}\b|@[a-z0-9-]+\.[a-z]{2,}/i); assert.equal(typeof win.MN_Money.mount, 'function');
});
