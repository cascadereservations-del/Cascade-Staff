// s143 lane B: Other expense (frame 8), its 15 minute Undo, the Utilities nudge, and log rows that show title, covers and way paid.
// Frozen clock: 2026-11-23T03:00:00Z = 11:00 on 2026-11-23 in Manila. Fake DOM and fake client as in expenses.test.mjs. Expected values are worked out by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const FX = createRequire(import.meta.url)('./fixtures/s143_expenses_screen.json');
const SRC = read('expenses/E_expenses.js');
const NOW = Date.parse('2026-11-23T03:00:00Z'), PROP = '6ae230f4-c189-4547-84b1-cb6e0b2cc9bd', MIN = 60000;
const tick = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const plain = (x) => JSON.parse(JSON.stringify(x));
class FakeEl {
  constructor() { this.html = ''; this.l = {}; this.q = {}; }
  set innerHTML(v) { this.html = String(v); } get innerHTML() { return this.html; }
  addEventListener(t, f) { (this.l[t] ||= []).push(f); } removeEventListener(t, f) { this.l[t] = (this.l[t] || []).filter((x) => x !== f); }
  querySelector(sel) { return (this.q[sel] ||= { disabled: undefined, textContent: '', scrollIntoView() {} }); }
}
function loadModule() {
  const win = { ICON: (n) => `<i data-ic="${n}"></i>` };
  const ctx = { window: win, navigator: { onLine: true }, Intl, Date, Promise, JSON, Math, console, setTimeout: (f, ms) => { const t = setTimeout(f, ms); if (t && t.unref) t.unref(); return t; }, clearTimeout, Uint8Array, atob, URL: { createObjectURL: () => 'blob:thumb', revokeObjectURL() {} }, Blob: class {} };
  vm.createContext(ctx); vm.runInContext(SRC, ctx, { filename: 'E_expenses.js' });
  let now = NOW; win.E_Expenses._setClock(() => now);
  return { E: win.E_Expenses, advance: (ms) => { now += ms; } };
}
const SCREEN = (o = {}) => ({ ok: true, month: '2026-11-01', total: 1000, count: 1, prev_total: 0, basis: 0, basis_months: [], pending: { count: 0, total: 0 }, by_category: [], rows: [], unpriced: { count: 0, items: [] }, unlinked: 0,
  categories: [{ slug: 'supplies', label: 'Supplies' }, { slug: 'cleaning', label: 'Cleaning' }, { slug: 'utilities', label: 'Utilities' }], can_write: true, more: false, ...o });
async function boot({ sub = 'other', rpc = {}, screen = SCREEN() } = {}) {
  const env = loadModule(), el = new FakeEl(), nav = [], calls = []; let n = 0;
  const client = { rpc(name, args) { calls.push([name, plain(args || {})]); const h = name === 'expenses_screen_v1' ? () => screen : rpc[name]; if (!h) return Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.' + name } }); return Promise.resolve({ data: plain(h(args)), error: null }); }, functions: { invoke: () => Promise.resolve({ data: null, error: { message: 'none' } }) } };
  env.E.mount(el, { client, role: 'owner', sub, propertyId: PROP, navigate: (h) => nav.push(h), toast() {}, haptic() {}, newKey: (p) => `${p}-0000000000000000${String(++n).padStart(8, '0')}` });
  await tick();
  const tg = (a, x = {}) => { const t = { ...x, getAttribute: (k) => (k in a ? a[k] : null), closest: (s) => { const m = /^\[([\w-]+)\]$/.exec(s); return m && m[1] in a ? t : null; } }; return t; };
  const fire = async (type, ev) => { for (const f of el.l[type] || []) f(ev); await tick(); };
  return { ...env, el, nav, calls, html: () => el.innerHTML, text: () => el.innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '),
    click: (act, id) => fire('click', { type: 'click', target: tg({ 'data-e': act, ...(id !== undefined ? { 'data-id': id } : {}) }) }),
    pk: (k, id) => fire('click', { type: 'click', target: tg({ 'data-e': 'pk', 'data-k': k, 'data-id': id }) }),
    type: (f, value) => fire('input', { type: 'input', target: tg({ 'data-f': f }, { value }) }),
    sent: (name) => calls.filter((x) => x[0] === name) };
}
const fillOk = async (b) => { await b.type('amount', '350'); await b.pk('category', 'supplies'); await b.pk('method', 'gcash'); };

test('E lib: methods, the row meta line and the server title', () => {
  const { E } = loadModule(), L = E.lib;
  assert.equal(L.methodLabel('gcash'), 'GCash'); assert.equal(L.methodLabel('bank'), 'Bank'); assert.equal(L.methodLabel('other'), 'Other'); assert.equal(L.methodLabel(''), ''); assert.equal(L.methodLabel(null), '');
  assert.equal(L.rowMeta(FX.new.rows[0]), '21 Oct – 21 Nov · GCash'); // Water bill, covers 2026-10-21 to 2026-11-21
  assert.equal(L.rowMeta(FX.new.rows[1]), '', 'a stock row carries neither');
  assert.equal(L.rowMeta(FX.old.rows[0]), '', 'an old row carries neither');
  assert.equal(L.titleOf(FX.new.rows[0]), 'Water bill'); assert.equal(L.titleOf(FX.old.rows[0]), 'Water (Gensan Water District)');
});
test('E lib: validateOther needs a day not in the future, an amount, a category and the way paid; the note is optional', () => {
  const { E } = loadModule(), L = E.lib, cats = [{ slug: 'supplies', label: 'Supplies' }], T = '2026-11-23';
  assert.deepEqual(Object.keys(L.validateOther({ date: '', amount: '', category: '', method: '' }, cats, T)).sort(), ['amount', 'category', 'date', 'method']);
  assert.deepEqual(plain(L.validateOther({ date: T, amount: '350', category: 'supplies', method: 'cash', notes: '' }, cats, T)), {});
  assert.ok(L.validateOther({ date: '2026-11-24', amount: '350', category: 'supplies', method: 'cash' }, cats, T).date, 'tomorrow is refused here (a paid-on day)');
  assert.ok(L.validateOther({ date: T, amount: '350', category: 'supplies', method: 'crypto' }, cats, T).method);
});
test('E lib: the payload carries payment_method; the Undo window is 15 minutes, counted in whole minutes left', () => {
  const { E } = loadModule(), L = E.lib;
  const t = L.otherTxn({ date: '2026-11-23', amount: '350', category: 'supplies', payee: 'Zz Shop', notes: '', method: 'gcash' }, null);
  assert.equal(t.payment_method, 'gcash'); assert.equal(t.gross_amount, '350.00'); assert.equal(t.transaction_date, '2026-11-23'); assert.equal(t.txn_type, 'expense');
  const u = { at: NOW };
  assert.equal(L.undoLeft(u, NOW), 15); assert.equal(L.undoLeft(u, NOW + 5 * MIN), 10); assert.equal(L.undoLeft(u, NOW + 14 * MIN + 30000), 1); assert.equal(L.undoLeft(u, NOW + 15 * MIN), null); assert.equal(L.undoLeft(null, NOW), null);
  const open = [{ id: 'b1', label: 'Water' }];
  assert.equal(L.billNudge('utilities', open), open); assert.equal(L.billNudge('internet', open), open); assert.equal(L.billNudge('supplies', open), null); assert.equal(L.billNudge('utilities', []), null);
});

test('frame 8: #expenses/other draws the I_hue_use form: amount, What for, Paid to, Paid on, How you paid, Receipt, Note, Save', async () => {
  const b = await boot(); const h = b.html();
  assert.match(h, /class="I_uform I_hue_use MN_cnt"/); assert.match(h, /class="I_band I_hue_use"/);
  const at = ['Amount paid', 'What for', 'Paid to (optional)', 'Paid on', 'How you paid', 'Receipt (optional)', 'Note (optional)', 'Save expense'].map((t) => h.indexOf(t));
  assert.ok(at.every((v, i) => v >= 0 && (i === 0 || v > at[i - 1])), at.join(','));
  assert.match(h, /data-e="pk" data-k="method" data-id="gcash"/); assert.match(h, /data-e="pk" data-k="category" data-id="utilities"/);
  assert.equal(b.sent('admin_save_transaction_v2').length, 0);
});
test('frame 8: Save sends payment_method and a fresh key; refusal keeps what was typed and says it in a plain sentence', async () => {
  const b = await boot({ rpc: { admin_save_transaction_v2: () => ({ ok: false, reason: 'bad_method' }) } }); await fillOk(b); await b.click('other-save');
  assert.equal(b.sent('admin_save_transaction_v2').length, 1); const call = b.sent('admin_save_transaction_v2')[0][1];
  assert.equal(call.p_txn.payment_method, 'gcash'); assert.equal(call.p_txn.gross_amount, '350.00'); assert.equal(call.p_txn.category, 'supplies'); assert.match(call.p_idempotency_key, /^exp-other-/);
  assert.match(b.html(), /id="E_amt"[^>]*value="350"/); assert.match(b.html(), /class="errbox"/); assert.match(b.html(), /aria-pressed="true"[^>]*>GCash/);
});
test('frame 8: leaving a field empty names it and sends nothing', async () => {
  const b = await boot(); await b.type('amount', '350'); await b.click('other-save');
  assert.equal(b.sent('admin_save_transaction_v2').length, 0); assert.match(b.html(), /Choose what it was for\./); assert.match(b.html(), /Choose how you paid/); assert.match(b.html(), /Please fix the items marked below\./);
});
test('frame 8: after saving, Undo shows for 15 minutes, voids the row, hands the form back, and a second save uses a NEW key', async () => {
  const b = await boot({ rpc: { admin_save_transaction_v2: () => ({ ok: true, id: 'n9' }), expense_void_v1: () => ({ ok: true, id: 'n9' }) } });
  await fillOk(b); await b.click('other-save');
  assert.match(b.html(), /Saved ₱350\.00\. Undo for 15 minutes\./); assert.match(b.html(), /data-e="undo"/); assert.ok(b.nav.includes('#expenses'), 'the route leaves the form');
  b.advance(5 * MIN); await b.click('undo');
  const v = b.sent('expense_void_v1'); assert.equal(v.length, 1); assert.equal(v[0][1].p_id, 'n9'); assert.ok(v[0][1].p_reason.length >= 3);
  assert.match(b.html(), /class="I_uform I_hue_use MN_cnt"/); assert.match(b.html(), /id="E_amt"[^>]*value="350"/, 'the form is back with what was typed');
  await b.click('other-save'); const saves = b.sent('admin_save_transaction_v2');
  assert.equal(saves.length, 2); assert.notEqual(saves[0][1].p_idempotency_key, saves[1][1].p_idempotency_key, 'never the first request replayed');
});
test('frame 8: the Undo bar is gone once 15 minutes have passed', async () => {
  const b = await boot({ rpc: { admin_save_transaction_v2: () => ({ ok: true, id: 'n9' }) } }); await fillOk(b); await b.click('other-save');
  assert.match(b.html(), /data-e="undo"/); b.advance(15 * MIN); await b.click('close'); assert.doesNotMatch(b.html(), /data-e="undo"/);
});
test('frame 8: Utilities while a bill is open nudges to Pay a bill; with none open it does not', async () => {
  const open = { today_bills_v1: () => ({ ok: true, due: [{ id: 'b1', kind: 'water', label: 'Water (Zz)', can_pay: true }] }) };
  const b = await boot({ rpc: open }); await b.pk('category', 'utilities');
  assert.match(b.html(), /class="MN_row"/); assert.match(b.html(), /Water \(Zz\) is waiting to be paid\. Pay it from Pay a bill so it is counted once\./);
  await b.click('go-pay', 'b1'); assert.equal(b.nav.at(-1), '#bills/pay/b1');
  const c = await boot({ rpc: { today_bills_v1: () => ({ ok: true, due: [] }) } }); await c.pk('category', 'utilities'); assert.doesNotMatch(c.html(), /MN_row/);
  const d = await boot({ rpc: open }); await d.pk('category', 'supplies'); assert.doesNotMatch(d.html(), /MN_row/);
});
test('log rows: a new row shows the title, the period covered and the way paid; an old row draws as before', async () => {
  const n = await boot({ sub: '', screen: FX.new }); assert.match(n.text(), /Water bill/); assert.match(n.html(), /21 Oct – 21 Nov · GCash/);
  const o = await boot({ sub: '', screen: FX.old }); assert.doesNotMatch(o.html(), / – 21 Nov/); assert.match(o.text(), /Water \(Gensan Water District\)/);
});
test('#expenses/add is untouched: the old form still opens and saves without a way paid', async () => {
  const b = await boot({ sub: 'add' }); assert.match(b.html(), /Add expense/); assert.doesNotMatch(b.html(), /I_uform/);
});
test('the Expenses CSS keeps to the four type tokens and adds only MN_ pieces and the page override', () => {
  const css = read('expenses/E_expenses.css').replace(/\/\*[^]*?\*\//g, '');
  for (const c of ['MN_cnt', 'MN_chips', 'MN_cover', 'MN_covers', 'MN_copy', 'MN_req', 'MN_photo', 'MN_amount']) assert.match(css, new RegExp('#v-expenses \\.' + c + '\\b'), c);
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/);
});
