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
let NOW_D = '2026-12-23'; CS.manilaToday = () => NOW_D; // a fixed Manila day: the fixtures are written for it
const EXP = createRequire(import.meta.url)('./fixtures/s143_expenses_screen.json').new;

async function screen(sub, rpc = () => ({ ok: true }), extra = {}) {
  const h = {}, nodes = {};
  const box = { innerHTML: '', addEventListener: (t, f) => { h[t] = f; }, removeEventListener() {}, querySelector: (s) => (nodes[s] ||= { disabled: false, textContent: '', innerHTML: '' }), querySelectorAll: () => [] };
  const calls = [], nav = [], st = { box, nodes, calls, nav, changes: 0, toasts: [] };
  MN.mount(box, { sub, propertyId: 'prop-1', navigate: (x) => nav.push(x), onChange() { st.changes++; }, toast: (m) => st.toasts.push(m), haptic() {}, payUrl: '', ...extra,
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
test('MN lib: previewView warns only on reading_warn === true (it is a boolean), whatever else is there', () => {
  const base = { ok: true, from: '2026-11-21', to: '2026-12-19', estimate_php: 3980 };
  assert.deepEqual(plain(L.previewView({ ...base, reading_warn: null })), { from: '21 Nov', to: '19 Dec', est: '₱3,980', warn: false });
  assert.equal(L.previewView({ ...base, reading_warn: true }).warn, true);
  for (const w of [false, null, undefined, 'Reading is lower than the last one', 1]) assert.equal(L.previewView({ ...base, reading_warn: w }).warn, false, String(w));
  assert.equal(L.previewView({ ok: false }), null); assert.equal(L.previewView({ ...base, estimate_php: 0 }).est, '');
});
test('MN lib: readingStart prefers the assumed end of the open bill, then the server next reading, then today; never a future day', () => {
  assert.deepEqual(plain(L.readingStart({ next_reading: '2026-12-21' }, '2026-12-23')), { date: '2026-12-21', assumed: true });
  assert.deepEqual(plain(L.readingStart({ next_reading: '2026-12-21' }, '2026-12-01')), { date: '2026-12-01', assumed: false });
  assert.deepEqual(plain(L.readingStart(undefined, '2026-12-01')), { date: '2026-12-01', assumed: false });
  const lb = { from: '2026-11-21', to: '2026-12-21', to_assumed: true, status: 'due' };
  assert.deepEqual(plain(L.readingStart({ last_bill: lb, next_reading: '2027-01-21' }, '2026-12-23')), { date: '2026-12-21', assumed: true }, 'the open bill end, not the next reading');
  assert.deepEqual(plain(L.readingStart({ last_bill: { ...lb, to: '2027-01-01' }, next_reading: '2027-01-21' }, '2026-12-23')), { date: '2026-12-23', assumed: false }, 'a future end is never offered');
  assert.deepEqual(plain(L.readingStart({ last_bill: { ...lb, to_assumed: false }, next_reading: '2027-01-21' }, '2026-12-23')), { date: '2026-12-23', assumed: false }, 'a real end date is not a guess');
  assert.deepEqual(plain(L.readingStart({ last_bill: { ...lb, status: 'paid' }, next_reading: '2026-12-22' }, '2026-12-23')), { date: '2026-12-22', assumed: true }, 'a paid bill is locked');
  assert.deepEqual(plain(L.readingStart({ cycle_from: '2026-12-21', cycle_from_assumed: true, next_reading: '2027-01-21' }, '2026-12-23')), { date: '2026-12-21', assumed: true }, 'no bill yet, assumed cycle start');
  assert.equal(L.kindFromSub('reading/water'), 'water'); assert.equal(L.kindFromSub('reading/gas'), ''); assert.equal(L.kindFromSub('reading'), ''); assert.equal(L.kindFromSub(''), '');
});
test('MN lib: lastReading is the bill start when its end is assumed, else its end, else a real cycle start', () => {
  assert.equal(L.lastReading({ last_bill: { from: '2026-11-21', to: '2026-12-21', to_assumed: true } }), '2026-11-21');
  assert.equal(L.lastReading({ last_bill: { from: '2026-11-21', to: '2026-12-19', to_assumed: false } }), '2026-12-19');
  assert.equal(L.lastReading({ cycle_from: '2026-12-21', cycle_from_assumed: false }), '2026-12-21');
  assert.equal(L.lastReading({ cycle_from: '2026-12-21', cycle_from_assumed: true }), ''); assert.equal(L.lastReading(null), '');
});
test('MN lib: ordinal, dueWords and heroLine say what the mockup says', () => {
  assert.deepEqual(['1', '2', '3', '4', '11', '12', '13', '21', '22', '23', '30'].map((n) => L.ordinal(n)), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '30th']);
  assert.equal(L.dueWords([{ kind: 'electric' }, { kind: 'water' }, { kind: 'water' }, { kind: 'netflix' }]), 'Electricity, Water, Subscription due'); assert.equal(L.dueWords([]), '');
  assert.equal(L.heroLine(7835, 3), '₱7,835 so far · 3 bills to pay'); assert.equal(L.heroLine(100, 1), '₱100 so far · 1 bill to pay'); assert.equal(L.heroLine(0, 0), '₱0 so far · no bills to pay');
  assert.equal(L.heroLine(null, 2), '2 bills to pay'); assert.equal(L.heroLine(50, null), '₱50 so far'); assert.equal(L.heroLine(null, null), '');
});
test('MN lib: payable keeps only rows the person can pay, in order', () => {
  const rows = L.payable(BILLS.A); assert.ok(rows.length >= 1); assert.ok(rows.every((r) => r.id && r.label));
  assert.deepEqual(plain(L.payable({ due: [{ id: 'a', can_pay: false }, { id: 'b', can_pay: true, kind: 'water', label: 'Water', due_day: 27, estimate_php: 212 }] })).map((r) => r.id), ['b']);
  assert.deepEqual(plain(L.payable(null)), []);
});

const bills = (n, a) => (n === 'today_bills_v1' ? BILLS.C : n === 'expenses_screen_v1' ? EXP : n === 'bill_reading_set_v1' ? (a.p_preview ? FX.preview : FX.saved) : { ok: true });

test('frame 5 (mockup): Log money header, month line, four rows with subtitles and the count badge, and the Reading date / See all footer', async () => {
  const s = await screen('', bills); const h = s.box.innerHTML;
  assert.match(h, /<h2[^>]*>Log money<\/h2>/); assert.match(h, /data-mact="home">✕ Close</);
  assert.match(h, /<b class="I_uname">December<\/b><p class="help">₱7,835 so far · 4 bills to pay<\/p>/);
  assert.match(h, /<b>Pay a bill<\/b><small>Electricity, Water, Internet, Subscription due<\/small><\/span><span class="MN_cnt" aria-label="due 4">4<\/span>/);
  assert.match(h, /<b>Bought stock<\/b><small>Scan a receipt or pick the item<\/small>/); assert.match(h, /<b>Other expense<\/b><small>Repairs, fees, anything else<\/small>/); assert.match(h, /<b>Pay staff<\/b><small>Cleaning fees and extras<\/small>/);
  assert.match(h, /I_hue_cnt/); assert.match(h, /I_hue_buy/); assert.match(h, /class="I_uopt I_hue_use"/); assert.match(h, /I_hue_lin/);
  assert.match(h, /<div class="I_umore"><button[^>]*data-mact="reading">📅 Reading date<\/button><button[^>]*data-mact="all">🕘 See all<\/button><\/div>/);
  assert.doesNotMatch(h, /waiting/i, 'no waiting-staff count: there is no source for it in this module');
  assert.equal(s.rpcs('expenses_screen_v1')[0].p_month, '2026-12-01'); assert.equal(s.rpcs('today_bills_v1').length, 1, 'one bills read serves the whole sheet');
  await s.click('home'); await s.click('other'); await s.click('stock'); await s.click('all');
  assert.deepEqual(s.nav, ['#home', '#expenses/other', '#stock', '#expenses']); MN.unmount();
});
test('frame 5: a read that fails leaves its part out; no bills says so; nothing is invented', async () => {
  const s = await screen('', (n) => (n === 'today_bills_v1' ? { ok: true, due: [] } : { ok: false })); let h = s.box.innerHTML;
  assert.match(h, /<p class="help">no bills to pay<\/p>/); assert.match(h, /Nothing is due right now/); assert.doesNotMatch(h, /MN_cnt/, 'no badge at zero'); assert.doesNotMatch(h, /so far/); MN.unmount();
  const f = await screen('', () => { throw new Error('offline'); }); h = f.box.innerHTML;
  assert.match(h, /What did you pay\?/); assert.match(h, /Pick the bill you are paying/); assert.doesNotMatch(h, /so far|to pay</); MN.unmount();
});
test('frame 5: Pay staff follows payUrl as a function or a string, and never falls back to the rate editor', async () => {
  const fn = await screen('', bills, { payUrl: () => '#pay/staff' }); assert.match(fn.box.innerHTML, /<a class="I_uopt I_hue_lin" href="#pay\/staff">/); assert.doesNotMatch(fn.box.innerHTML, /data-mact="staff"/); MN.unmount();
  const str = await screen('', bills, { payUrl: '#pay/staff' }); assert.match(str.box.innerHTML, /<a class="I_uopt I_hue_lin" href="#pay\/staff">/); MN.unmount();
  for (const bad of ['', () => '', () => { throw new Error('x'); }, 'javascript:alert(1)', () => 'javascript:alert(1)', null, 7]) {
    const s = await screen('', bills, { payUrl: bad }); assert.doesNotMatch(s.box.innerHTML, /<a class="I_uopt/); await s.click('staff');
    assert.match(s.box.innerHTML, /Pay staff is not available here right now\./); assert.deepEqual(s.nav, []); assert.ok(!s.nav.some((x) => /payrates/.test(x))); MN.unmount();
  }
});
test('frame 5: Pay a bill lists the open bills the person can pay and opens the pay form', async () => {
  const s = await screen('', (n) => (n === 'today_bills_v1' ? { ok: true, due: [{ id: 'b1', kind: 'water', label: 'Water (Zz)', can_pay: true, due_day: 27, estimate_php: 212 }, { id: 'b2', kind: 'internet', label: 'Internet', can_pay: false }] } : { ok: true }));
  await s.click('bills'); const h = s.box.innerHTML; assert.match(h, /Water \(Zz\)/); assert.doesNotMatch(h, />Internet</); assert.match(h, /₱212 · due the 27th/);
  await s.click('bill', { id: 'b1' }); assert.equal(s.nav.at(-1), '#bills/pay/b1'); MN.unmount();
  const none = await screen('', (n) => (n === 'today_bills_v1' ? { ok: true, due: [] } : { ok: true })); await none.click('bills');
  assert.match(none.box.innerHTML, /No bills are waiting to be paid right now\./); MN.unmount();
});

test('frame 9 (mockup): meter tiles with the last reading, the date, the unit, an automatic preview, the info row and the save bar', async () => {
  const s = await screen('reading/electric', bills); const h = s.box.innerHTML;
  assert.match(h, /data-v="electric" aria-pressed="true"[^>]*><span[^>]*>⚡<\/span><b>Electricity<\/b><small>last 21 Nov<\/small>/); assert.match(h, /data-v="water" aria-pressed="false"[^>]*><span[^>]*>💧<\/span><b>Water<\/b><small>last 21 Nov<\/small>/);
  assert.match(h, /Present reading \(optional\)/); assert.match(h, /<span>kWh<\/span>/); assert.doesNotMatch(h, /Electricity meter|See the estimate/);
  assert.deepEqual(s.rpcs('bill_reading_set_v1'), [{ p_property_id: 'prop-1', p_kind: 'electric', p_reading_date: '2026-12-21', p_reading_value: null, p_preview: true }], 'the preview ran by itself, nothing was saved');
  assert.match(h, /<div class="I_flow"[^>]*><div class="I_fn"><b>21 Nov<\/b><small>from<\/small><\/div><span[^>]*>→<\/span><div class="I_fn I_fto"><b>19 Dec<\/b><small>to · est\. ₱3,980<\/small>/);
  assert.match(h, /<div class="I_info">ℹ From now on the app expects the 21st each month, until you set a new date\.<\/div>/);
  assert.match(h, /id="MN_go"[^>]*>Set 21 Dec as the reading date<\/button>/); assert.doesNotMatch(h, /id="MN_go"[^>]*disabled/); assert.equal(s.changes, 0, 'a preview changes nothing on Today');
  await s.click('kind', { v: 'water' }); assert.match(s.box.innerHTML, /<span>m³<\/span>/); assert.equal(s.rpcs('bill_reading_set_v1').at(-1).p_kind, 'water'); MN.unmount();
});
test('frame 9: typing a date or a reading previews again at once; the save then sends what is on screen with p_preview false', async () => {
  const s = await screen('reading/electric', bills);
  await s.type('MN_date', '2026-12-19'); await s.type('MN_val', '1,234.5');
  assert.deepEqual(s.rpcs('bill_reading_set_v1').map((x) => [x.p_reading_date, x.p_reading_value, x.p_preview]), [['2026-12-21', null, true], ['2026-12-19', null, true], ['2026-12-19', 1234.5, true]]);
  assert.match(s.box.innerHTML, /expects the 19th each month/); assert.match(s.box.innerHTML, /Set 19 Dec as the reading date/); assert.match(s.box.innerHTML, /id="MN_val"[^>]*value="1,234\.5"/);
  await s.click('go'); const r = s.rpcs('bill_reading_set_v1'); assert.equal(r.length, 4); assert.deepEqual(r[3], { p_property_id: 'prop-1', p_kind: 'electric', p_reading_date: '2026-12-19', p_reading_value: 1234.5, p_preview: false });
  assert.match(s.box.innerHTML, /Saved\. Electricity now runs 21 Nov – 19 Dec, about ₱3,980\./); assert.equal(s.changes, 1); assert.deepEqual(s.toasts, ['Reading date saved']);
  MN.unmount();
});
test('frame 9: no estimate yet means the save bar is off; a date in the future or a bad reading never previews', async () => {
  let hold; const s = await screen('reading/electric', (n) => (n === 'bill_reading_set_v1' ? new Promise((r) => { hold = () => r(FX.preview); }) : n === 'today_bills_v1' ? BILLS.C : { ok: true }));
  assert.match(s.box.innerHTML, /id="MN_go"[^>]*disabled/); hold(); await flush(); assert.doesNotMatch(s.box.innerHTML, /id="MN_go"[^>]*disabled/);
  const n0 = s.rpcs('bill_reading_set_v1').length; await s.type('MN_date', '2026-12-24'); await s.type('MN_val', 'abc'); assert.equal(s.rpcs('bill_reading_set_v1').length, n0, 'future date and bad value call nothing');
  assert.equal(s.nodes['#MN_go'].disabled, true, 'the live save button is off'); MN.unmount();
});
test('frame 9: reading_warn true is one plain sentence; false, null or missing shows nothing', async () => {
  for (const [w, shown] of [[true, true], [false, false], [null, false]]) {
    const s = await screen('reading/water', (n) => (n === 'bill_reading_set_v1' ? { ...FX.preview, reading_warn: w } : { ok: true }));
    assert.equal(s.box.innerHTML.includes('The reading is far from the meter log. Check that it was typed right.'), shown, String(w)); MN.unmount();
  }
  const { reading_warn, ...none } = FX.preview; const m = await screen('reading/water', (n) => (n === 'bill_reading_set_v1' ? none : { ok: true })); assert.doesNotMatch(m.box.innerHTML, /far from the meter log/); assert.match(m.box.innerHTML, /I_flow/); MN.unmount();
});
test('frame 9: the date starts on the open bill end (assumed) from the real bills payload, labelled assumed, for both meters; a real date is not labelled', async () => {
  for (const kind of ['electric', 'water']) {
    const s = await screen('reading/' + kind, bills); const h = s.box.innerHTML;
    assert.match(h, /Reading date on the bill \(assumed\)/); assert.match(h, /id="MN_date"[^>]*value="2026-12-21"/); assert.match(h, /MN_assumed/); assert.equal(s.rpcs('bill_reading_set_v1')[0].p_reading_date, '2026-12-21'); MN.unmount();
  }
  NOW_D = '2026-11-23'; const a = await screen('reading/electric', (n) => (n === 'today_bills_v1' ? BILLS.A : { ok: true })); assert.match(a.box.innerHTML, /id="MN_date"[^>]*value="2026-11-21"/); assert.match(a.box.innerHTML, /\(assumed\)/); MN.unmount();
  NOW_D = '2026-12-23'; const real = JSON.parse(JSON.stringify(BILLS.C)); real.electric.last_bill.to_assumed = false; real.electric.last_bill.to = '2026-12-19'; real.electric.next_reading = '2027-01-19';
  const r = await screen('reading/electric', (n) => (n === 'today_bills_v1' ? real : { ok: true })); assert.match(r.box.innerHTML, /Reading date on the bill<\/label>/); assert.match(r.box.innerHTML, /id="MN_date"[^>]*value="2026-12-23"/); assert.match(r.box.innerHTML, /<small>last 19 Dec<\/small>/); MN.unmount();
});
test('frame 9: changing the date after a preview throws the old one away, so a save is always of what is on screen', async () => {
  const s = await screen('reading/water', bills); await s.type('MN_date', '2026-12-18');
  assert.deepEqual(s.rpcs('bill_reading_set_v1').map((x) => [x.p_reading_date, x.p_preview]), [['2026-12-21', true], ['2026-12-18', true]]); assert.match(s.box.innerHTML, /Set 18 Dec as the reading date/); MN.unmount();
});
test('frame 9: a refusal is one plain sentence with every date as d Mon, and the typed date and reading stay', async () => {
  for (const [key, re] of [['reading_date_invalid_after', /The reading date must be after 21 Nov, the day of the last reading/], ['reading_date_invalid_before', /The reading date must be before 23 Dec, the day of the next reading/]]) {
    const s = await screen('reading/water', (n) => (n === 'bill_reading_set_v1' ? FX.refusals[key] : { ok: true }));
    await s.type('MN_date', '2026-11-20'); await s.type('MN_val', '4,321'); const h = s.box.innerHTML;
    assert.match(h, re); assert.doesNotMatch(h, /(after|before) 20\d\d-/, 'no raw ISO day in a sentence'); assert.match(h, /id="MN_date"[^>]*value="2026-11-20"/); assert.match(h, /id="MN_val"[^>]*value="4,321"/); assert.match(h, /id="MN_go"[^>]*disabled/); MN.unmount();
  }
  const net = await screen('reading/water', (n) => { if (n === 'bill_reading_set_v1') throw new Error('offline'); return { ok: true }; });
  assert.match(net.box.innerHTML, /That did not go through\. Check your connection and try again\./); MN.unmount();
});
test('frame 9: no meter chosen means the save bar is off and nothing is previewed until Electricity or Water is picked', async () => {
  const s = await screen('reading', bills); assert.match(s.box.innerHTML, /id="MN_go"[^>]*disabled/); assert.equal(s.rpcs('bill_reading_set_v1').length, 0);
  await s.click('kind', { v: 'water' }); assert.match(s.box.innerHTML, /Reading date on the bill \(assumed\)/); assert.equal(s.rpcs('bill_reading_set_v1')[0].p_kind, 'water'); assert.doesNotMatch(s.box.innerHTML, /id="MN_go"[^>]*disabled/); MN.unmount();
});
test('an unknown sub-route goes back to #money; no client says so in a sentence', async () => {
  const s = await screen('nonsense'); assert.deepEqual(s.nav, ['#money']); MN.unmount();
  const box = { innerHTML: '', addEventListener() {}, removeEventListener() {}, querySelector: () => null }; MN.mount(box, { sub: '', navigate() {} }); assert.match(box.innerHTML, /Money needs a connection/); MN.unmount();
});
test('CSS (R1): every MN_ piece is defined once in money/MN_money.css, none in the bills or expenses css, MN_row is left to styles.css, tokens only', () => {
  const strip = (f) => read(f).replace(/\/\*[^]*?\*\//g, ''), mn = strip('money/MN_money.css');
  const defined = [...new Set([...mn.matchAll(/\.(MN_[A-Za-z]+)\b/g)].map((m) => m[1]))];
  for (const c of ['MN_cnt', 'MN_chips', 'MN_cover', 'MN_covers', 'MN_copy', 'MN_req', 'MN_photo', 'MN_amount', 'MN_form', 'MN_fixed', 'MN_helprow', 'MN_stack']) assert.ok(defined.includes(c), c + ' is defined in MN_money.css');
  assert.ok(!defined.includes('MN_row'), 'MN_row belongs to styles.css');
  for (const f of ['bills/BL_bills.css', 'expenses/E_expenses.css']) assert.doesNotMatch(strip(f), /MN_/, f + ' defines no MN_ class');
  assert.doesNotMatch(mn, /#[0-9a-fA-F]{3,8}\b/); assert.doesNotMatch(mn, /rgba?\(|hsla?\(/); assert.doesNotMatch(mn, /font-size:\s*[\d.]+px/);
  const hooks = new Set(['MN_row', 'MN_page', 'MN_assumed']);
  for (const f of ['money/MN_money.js', 'bills/BL_bills.js', 'expenses/E_expenses.js']) for (const m of read(f).matchAll(/class="([^"]*)"/g)) for (const t of m[1].split(/\s+/)) if (/^MN_/.test(t) && !hooks.has(t)) assert.ok(defined.includes(t), t + ' used in ' + f + ' has a rule');
  assert.equal(mn.split('.MN_cnt {').length, 2, 'one MN_cnt rule');
});
test('hygiene: plain script, one global, no eval or network of its own, no real names or numbers', () => {
  const src = read('money/MN_money.js'); assert.doesNotThrow(() => new vm.Script(src)); assert.doesNotMatch(src, /\beval\(|new Function|document\.write|fetch\(|XMLHttpRequest|localStorage/);
  assert.doesNotMatch(src, /\b09\d{9}\b|@[a-z0-9-]+\.[a-z]{2,}/i); assert.equal(typeof win.MN_Money.mount, 'function'); assert.equal(typeof win.MN_Money.reset, 'function'); assert.equal(typeof win.MN_Money.unmount, 'function');
});
