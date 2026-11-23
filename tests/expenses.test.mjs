// s134 lane L2 (Staff 3.4.53): expenses/E_expenses.js, the Today card, the Manage hand-over, the KPI copy, the receipt hand-off to Inventory.
// Frozen clock: 2026-11-23T03:00:00Z = 11:00 on 2026-11-23 in Manila. The module runs in a vm sandbox with a tiny fake DOM and a fake Supabase client that records every call.
// Contract: docs/s134/SPEC.md (6, 8, 13, 14) and PLAN.md (L2). Hand-computed expectations throughout.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const SRC = read('expenses/E_expenses.js'), CSS = read('expenses/E_expenses.css'), APP = read('app.js'), MAN = read('manage/N_manage.js'), SW = read('sw.js'), STY = read('styles.css');
const NOW = Date.parse('2026-11-23T03:00:00Z'), TODAY = '2026-11-23', PROP = '6ae230f4-c189-4547-84b1-cb6e0b2cc9bd';
const tick = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const plain = (x) => JSON.parse(JSON.stringify(x));

class FakeEl {
  constructor() { this.html = ''; this.l = {}; this.q = {}; }
  set innerHTML(v) { this.html = String(v); }
  get innerHTML() { return this.html; }
  addEventListener(t, f) { (this.l[t] ||= []).push(f); }
  removeEventListener(t, f) { this.l[t] = (this.l[t] || []).filter((x) => x !== f); }
  querySelector(sel) { return (this.q[sel] ||= { disabled: undefined, scrollIntoView() {} }); } // one stub per selector: lets a test read what a keystroke switched on or off
}
function loadModule() {
  const win = { ICON: (n) => `<i data-ic="${n}"></i>` };
  const ctx = { window: win, navigator: { onLine: true }, Intl, Date, Promise, JSON, Math, console, setTimeout, clearTimeout, Uint8Array, atob, URL: { createObjectURL: () => 'blob:thumb', revokeObjectURL() {} }, Blob: class {} };
  vm.createContext(ctx); vm.runInContext(SRC, ctx, { filename: 'E_expenses.js' });
  win.E_Expenses._setClock(() => NOW);
  return { E: win.E_Expenses, win, ctx };
}
const ROW = (o = {}) => ({ id: 'r1', date: '2026-11-22', amount: '1200.00', category: 'supplies', label: 'Supplies', payee: 'Sample hardware', notes: 'Bulbs', status: 'confirmed', chip: 'manual', has_receipt: false, locked: false, amount_locked: false,
  stock: null, lookalike_id: null, created_at: '2026-11-22T02:00:00Z', receipt_ref: null, receipt_can: { add: true, replace: false, remove: false }, ...o });
const SCREEN = (o = {}) => ({ ok: true, month: '2026-11-01', total: 38420, count: 3, prev_total: 41200, basis: 47413, basis_months: ['2026-08', '2026-09', '2026-10'], pending: { count: 2, total: 1850 },
  by_category: [{ category: 'supplies', label: 'Supplies', txn_type: 'expense', total: 20000, count: 5 }, { category: 'rent', label: 'Rent income', txn_type: 'income', total: 99999, count: 1 }, { category: 'cleaning', label: 'Cleaning', txn_type: 'expense', total: 18420, count: 4 }],
  rows: [ROW(), ROW({ id: 'r2', date: '2026-11-22', amount: '300.00', category: 'cleaning', label: 'Cleaning', payee: 'Ana', chip: 'staff_pay', locked: true, amount_locked: true }), ROW({ id: 'r3', date: '2026-11-21', amount: '540.00', chip: 'stock', stock: { lines: 3, items: 3 }, amount_locked: true }),
    ROW({ id: 'p1', date: '2026-11-20', amount: '900.00', status: 'pending_review', chip: 'telegram', lookalike_id: 'r3' }), ROW({ id: 'p2', date: '2026-11-19', amount: '950.00', status: 'pending_review', chip: 'receipt' })],
  unpriced: { count: 3, items: ['Soap', 'Towels', 'Bleach'] }, unlinked: 0, categories: [{ slug: 'supplies', label: 'Supplies' }, { slug: 'cleaning', label: 'Cleaning' }, { slug: 'utilities', label: 'Utilities' }], can_write: true, more: false, ...o });

function fakeClient({ rpc = {}, fn = {} } = {}) {
  const calls = [], fns = [];
  return {
    calls, fns,
    rpc(name, args) { calls.push([name, plain(args || {})]); const h = rpc[name]; if (!h) return Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.' + name } }); const r = h(args); return Promise.resolve(r && 'data' in r && 'error' in r ? r : { data: plain(r), error: null }); },
    functions: { invoke(name, o) { fns.push([name, plain(o.body)]); const h = fn[o.body.mode]; if (!h) return Promise.resolve({ data: null, error: { context: { status: 404, json: () => Promise.resolve({}) } } }); const r = h(o.body); return Promise.resolve(r && r.error ? r : { data: plain(r), error: null }); } }
  };
}
async function boot({ role = 'owner', sub, rpc, fn, screen = SCREEN(), shrinkImage, readFile, payUrl } = {}) {
  const env = loadModule(), el = new FakeEl(), nav = [], toasts = [];
  const client = fakeClient({ rpc: { expenses_screen_v1: () => screen, ...rpc }, fn });
  let n = 0;
  env.E.mount(el, { client, role, sub, propertyId: PROP, navigate: (h) => nav.push(h), toast: (m) => toasts.push(m), haptic() {}, newKey: (p) => `${p}-0000000000000000${String(++n).padStart(8, '0')}`, shrinkImage, readFile, payUrl });
  await tick();
  const fire = async (type, ev) => { for (const f of el.l[type] || []) f(ev); await tick(); };
  const target = (attrs, extra = {}) => { const t = { ...extra, getAttribute: (k) => (k in attrs ? attrs[k] : null), closest: (sel) => { const m = /^\[([\w-]+)\]$/.exec(sel); return m && m[1] in attrs ? t : null; } }; return t; };
  return { ...env, el, client, nav, toasts, html: () => el.innerHTML, text: () => el.innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '),
    click: (act, id) => fire('click', { type: 'click', target: target({ 'data-e': act, ...(id !== undefined ? { 'data-id': id } : {}) }) }),
    type: (f, value, ev = 'input') => fire(ev, { type: ev, target: target({ 'data-f': f }, { value }) }),
    pick: (file) => fire('change', { type: 'change', target: target({ 'data-e': 'file' }, { files: [file], value: '' }) }),
    sent: (name) => client.calls.filter((x) => x[0] === name) };
}
const ATTACH = (o = {}) => ({ ok: true, receipt_path: 'tx/abc.jpg', sha256: 'f'.repeat(64), mime: 'image/jpeg', suggest: { amount: 1250, date: '2026-11-20', vendor: 'Sample Hardware', category: 'supplies', line_items: [{ description: 'Bulbs' }], confidence: 0.9 }, stock_hint: { count: 0, names: [] }, ...o });
const JPG = { name: 'r.jpg', type: 'image/jpeg', size: 1000 };
const SHRINK = () => Promise.resolve({ base64: 'QUJD', mime: 'image/jpeg' });
const fill = async (b, f) => { for (const [k, v] of Object.entries(f)) await b.type(k, v); };

// ------------------------------------------------------------------------------------------------ pure helpers
test('E lib: amounts, pesos, validation and the create payload', () => {
  const { E } = loadModule(), L = E.lib;
  assert.equal(L.parseAmount('1,250.5'), '1250.50'); assert.equal(L.parseAmount('0'), null); assert.equal(L.parseAmount('12.345'), null); assert.equal(L.parseAmount('PHP 5073'), '5073.00');
  assert.equal(L.peso('1250'), '₱1,250.00'); assert.equal(L.peso(38420.4, true), '₱38,420'); assert.equal(L.peso(null), '—');
  const cats = [{ slug: 'supplies', label: 'Supplies' }];
  assert.deepEqual(Object.keys(L.validateExpense({ date: '', amount: '', category: '', notes: '' }, cats, TODAY)).sort(), ['amount', 'category', 'date', 'notes']);
  assert.equal(L.validateExpense({ date: '2026-11-24', amount: '1', category: 'supplies', notes: 'x' }, cats, TODAY).date, undefined, 'Manila tomorrow is allowed (the server allows it)');
  assert.equal(L.validateExpense({ date: '2026-11-25', amount: '1', category: 'supplies', notes: 'x' }, cats, TODAY).date, 'The date can’t be later than tomorrow.');
  assert.equal(L.validateExpense({ date: '2026-12-01', amount: '1', category: 'supplies', notes: 'x' }, '2026-11-30').date, undefined, 'tomorrow across a month end');
  const f = { date: '2026-11-22', amount: '1,200', category: 'supplies', payee: ' Shop ', notes: ' Bulbs ' };
  assert.deepEqual(plain(L.expenseTxn(f, null)), { txn_type: 'expense', category: 'supplies', transaction_date: '2026-11-22', gross_amount: '1200.00', payee_name: 'Shop', notes: 'Bulbs', or_number: '', reason: '' });
  const t = L.expenseTxn(f, { path: 'tx/a.jpg', confidence: 0.8, raw: { a: 1 } }); assert.equal(t.receipt_image_path, 'tx/a.jpg'); assert.equal(t.ocr_confidence, 0.8); assert.deepEqual(plain(t.ocr_raw), { a: 1 });
});
test('E lib: edit payload sends only what changed plus id and reason; locked rows send category and notes only; never a receipt key', () => {
  const { E } = loadModule(), L = E.lib, r = ROW({ id: 'x1' });
  const base = { date: r.date, amount: '1200.00', category: 'supplies', payee: 'Sample hardware', notes: 'Bulbs' };
  assert.deepEqual(plain(L.editPayload(r, { ...base, amount: '1250' }, ' typo ')), { id: 'x1', gross_amount: '1250.00', reason: 'typo' });
  assert.deepEqual(plain(L.editPayload(ROW({ id: 'x2', amount_locked: true }), { ...base, amount: '5', notes: 'New' }, 'why')), { id: 'x2', notes: 'New', reason: 'why' });
  assert.deepEqual(plain(L.editPayload(ROW({ id: 'x3', locked: true, amount_locked: true }), { ...base, date: '2026-11-01', amount: '5', payee: 'Z', category: 'cleaning', notes: 'N' }, 'why')), { id: 'x3', category: 'cleaning', notes: 'N', reason: 'why' });
  assert.ok(!Object.keys(L.editPayload(r, { ...base, amount: '9' }, 'abc')).some((k) => /receipt|ocr/.test(k)));
});
test('E lib: the suggestion is amount-only, for an editable row, and says so when it matches', () => {
  const { E } = loadModule(), L = E.lib;
  assert.deepEqual(plain(L.suggestion(ROW(), { amount: 1250 })), { same: false, amount: '1250.00' }); assert.deepEqual(plain(L.suggestion(ROW(), { amount: '1200' })), { same: true, amount: '1200.00' });
  assert.equal(L.suggestion(ROW({ amount_locked: true }), { amount: 5 }), null); assert.equal(L.suggestion(ROW({ locked: true }), { amount: 5 }), null); assert.equal(L.suggestion(ROW(), { amount: null }), null); assert.equal(L.suggestion(ROW(), null), null);
});
test('E lib: files, messages and the routing rule', () => {
  const { E } = loadModule(), L = E.lib;
  assert.equal(L.fileCheck({ type: 'application/pdf', size: 5 * 1024 * 1024 + 1 }), 'That file is over 5 MB.'); assert.equal(L.fileCheck({ type: 'application/pdf', size: 5 * 1024 * 1024 }), '');
  assert.equal(L.fileCheck({ type: 'text/plain', size: 10 }), 'Use a photo or a PDF.'); assert.equal(L.fileCheck({ type: 'image/jpeg', size: 9000000 }), ''); assert.equal(L.fileCheck(null), 'Use a photo or a PDF.');
  assert.equal(L.dupMsg('Stock bought 21 Nov'), 'This receipt is already on Stock bought 21 Nov.'); assert.equal(L.dupMsg({ chip: 'stock', date: '2026-11-21', amount: '540.00' }), 'This receipt is already on Stock 21 Nov (₱540.00).');
  assert.equal(L.basisText(['2026-08', '2026-09', '2026-10']), 'average of Aug to Oct'); assert.equal(L.basisText(3), 'average of the last 3 months'); assert.equal(L.basisText(null), '');
  const rc = { path: 'p' };
  assert.equal(L.routeVisible('owner', { kind: 'add', rc, stockHint: { count: 1 }, f: {} }), true); assert.equal(L.routeVisible('admin', { kind: 'add', rc, f: { category: 'supplies' } }), true);
  assert.equal(L.routeVisible('finance', { kind: 'add', rc, stockHint: { count: 2 }, f: {} }), false); assert.equal(L.routeVisible('owner', { kind: 'detail', rc, stockHint: { count: 2 }, f: {} }), false);
  assert.equal(L.routeVisible('owner', { kind: 'add', rc: null, stockHint: { count: 2 }, f: {} }), false); assert.equal(L.routeVisible('owner', { kind: 'add', rc, f: { category: 'cleaning' } }), false);
  assert.equal(L.nudgeFor('utilities'), 'Pay scheduled bills in Bills'); assert.equal(L.nudgeFor('cleaning'), 'Pay staff through Pay staff'); assert.equal(L.nudgeFor('supplies'), 'If this went into stock, use Inventory > Bought'); assert.equal(L.nudgeFor('other'), '');
});

// ------------------------------------------------------------------------------------------------ the screen
test('E screen: reads expenses_screen_v1 for the month, draws the summary, categories from by_category (expense only), review, folded unpriced line and the list', async () => {
  const b = await boot();
  assert.deepEqual(b.sent('expenses_screen_v1')[0][1], { p_property_id: PROP, p_month: '2026-11-01', p_limit: 100, p_filter: null });
  const t = b.text();
  assert.match(t, /Spent this month ₱38,420/); assert.match(t, /Usual month ₱47,413 \(average of Aug to Oct\)/); assert.match(t, /Last month ₱41,200/);
  assert.match(t, /2 waiting for review · ₱1,850 not counted yet/); assert.doesNotMatch(t, /Rent income/); assert.match(t, /Supplies ₱20,000/); assert.match(t, /Cleaning ₱18,420/);
  assert.match(t, /Needs review/); assert.match(t, /Looks like Stock 21 Nov \(₱540\.00\)/);
  assert.match(t, /3 stock purchases have no price/); assert.doesNotMatch(t.slice(t.indexOf('3 stock purchases'), t.indexOf('3 stock purchases') + 40), /₱/, 'the folded line carries no amount');
  assert.equal((b.html().match(/data-id="p1"/g) || []).length, 1, 'a needs-review row is drawn once, not again in the day list');
  assert.match(t, /Yesterday/); assert.match(b.html(), /E_sticky/);
  assert.match(b.html(), /Add expense<\/button><button[^>]*>Scan receipt/);
});
test('E screen: stepper never goes past this month; filters go to the server by chip, categories filter on the phone', async () => {
  const b = await boot();
  assert.match(b.html(), /data-e="next"[^>]*disabled/);
  await b.click('prev'); assert.equal(b.sent('expenses_screen_v1')[1][1].p_month, '2025-10-01'.replace('2025-10', '2026-10'));
  await b.click('chip', 'stock'); assert.equal(b.sent('expenses_screen_v1')[2][1].p_filter, 'stock');
  await b.click('chip', 'all'); assert.equal(b.sent('expenses_screen_v1')[3][1].p_filter, null);
  const before = b.client.calls.length; await b.click('cat', 'cleaning'); assert.equal(b.client.calls.length, before, 'no call for a category filter');
  assert.doesNotMatch(b.html().split('E_day')[1] || '', /data-id="r1"/); assert.match(b.html(), /data-id="r2"/);
});
test('E screen: empty month, no write right, offline and forbidden', async () => {
  let b = await boot({ screen: SCREEN({ rows: [], total: 0, count: 0, pending: { count: 0, total: 0 }, unpriced: { count: 0, items: [] }, by_category: [] }) });
  assert.match(b.text(), /No expenses logged for November yet\./); assert.match(b.html(), /E_sticky/);
  assert.ok(b.text().split(' ').length < 120, 'the empty state stays short');
  b = await boot({ screen: SCREEN({ can_write: false }) }); assert.doesNotMatch(b.html(), /E_sticky/);
  b = await boot({ screen: { ok: false, error: 'forbidden' } }); assert.match(b.text(), /not open to your account/);
});
test('E screen: Show more asks for the next 100 after the last row; See all opens every review row', async () => {
  const b = await boot({ screen: SCREEN({ more: true }) });
  await b.click('more'); const c = b.sent('expenses_screen_v1')[1][1]; assert.equal(c.p_limit, 100); assert.equal(c.p_before, '2026-11-22T02:00:00Z', 'the last listed row created_at'); assert.equal(c.p_before_id, 'p2', 'and its id: the cursor is (created_at, id)');
});
test('E access: owner, admin and finance mount; cleaner, inspector, maintenance and laundry are sent home and nothing is read', async () => {
  for (const role of ['owner', 'admin', 'finance']) { const b = await boot({ role }); assert.equal(b.sent('expenses_screen_v1').length, 1, role); }
  for (const role of ['cleaner', 'inspector', 'maintenance', 'laundry', 'viewer', '']) { const b = await boot({ role }); assert.deepEqual(b.nav, ['#home'], String(role)); assert.equal(b.client.calls.length, 0); assert.equal(b.html(), ''); }
  assert.match(APP, /expenses: \{ src: 'expenses\/E_expenses\.js', css: 'expenses\/E_expenses\.css', global: 'E_Expenses', title: 'Expenses', roles: \['owner', 'admin', 'finance'\], demoClient: true \}/);
  assert.match(APP, /function A_loadExpenses\(\) \{\n\s+if \(!state\.access \|\| state\.expensesAbsent \|\| state\.layout !== 'admin' \|\| !\/\^\(owner\|admin\|finance\)\$\/\.test\(role\(\) \|\| ''\)\) return;/);
  assert.match(APP, /function A_expCard\(\) \{\n\s+var e = state\.expenses; if \(!e \|\| state\.layout !== 'admin' \|\| !\/\^\(owner\|admin\|finance\)\$\/\.test\(role\(\) \|\| ''\)\) return '';/);
  assert.match(APP, /p_property_id: pid\(\), p_limit: 0 \}/); assert.match(APP, /A_billsCard\(\) \+ A_expCard\(\) \+ \(BD\.top/);
});

// ------------------------------------------------------------------------------------------------ add, edit, void, review
test('E add: one form; validation first; save sends v2 once with an idempotency key; a plain save toasts', async () => {
  const b = await boot({ sub: 'add', rpc: { admin_save_transaction_v2: () => ({ ok: true, id: 'n1', lookalike: null }) } });
  assert.match(b.html(), /Add expense/); assert.match(b.html(), /Scan or upload receipt/);
  await b.click('save'); assert.equal(b.sent('admin_save_transaction_v2').length, 0); assert.match(b.text(), /Please fix the items marked below/);
  await fill(b, { amount: '1,200', category: 'supplies', notes: 'Bulbs', payee: 'Shop' }); await b.click('review-add');
  assert.equal(b.sent('admin_save_transaction_v2').length, 0, 'the review step sends nothing'); assert.match(b.text(), /Check this before you save\. It is counted in the books at once\./); assert.match(b.text(), /Mon 23 Nov 2026/); assert.match(b.text(), /₱1,200\.00/); assert.match(b.text(), /Paid to Shop/);
  await b.click('save');
  const [name, a] = b.sent('admin_save_transaction_v2')[0];
  assert.deepEqual(plain(a), { p_property_id: PROP, p_txn: { txn_type: 'expense', category: 'supplies', transaction_date: TODAY, gross_amount: '1200.00', payee_name: 'Shop', notes: 'Bulbs', or_number: '', reason: '' }, p_idempotency_key: 'exp-add-000000000000000000000001' });
  assert.equal(name, 'admin_save_transaction_v2'); assert.ok(b.toasts.includes('Saved.')); assert.doesNotMatch(b.html(), /E_sheet/);
  assert.ok(b.nav.includes('#expenses'), 'closing #expenses/add goes back to the list');
});
test('E add: a look-alike after saving asks once; Yes voids the new row as the same purchase, No keeps both', async () => {
  const look = { id: 'r3', date: '2026-11-21', amount: '540.00', chip: 'stock' };
  let b = await boot({ rpc: { admin_save_transaction_v2: () => ({ ok: true, id: 'n9', lookalike: look }), expense_void_v1: () => ({ ok: true, id: 'n9', status: 'void' }) } });
  await b.click('add'); await fill(b, { amount: '540', category: 'supplies', notes: 'Stock' }); await b.click('review-add'); await b.click('save');
  assert.match(b.text(), /Saved\. Same as Stock 21 Nov \(₱540\.00\)\?/); await b.click('same-yes');
  assert.deepEqual(b.sent('expense_void_v1')[0][1], { p_property_id: PROP, p_id: 'n9', p_reason: 'Same purchase as Stock 21 Nov (₱540.00)', p_same_as: 'r3' });
  b = await boot({ rpc: { admin_save_transaction_v2: () => ({ ok: true, id: 'n9', lookalike: look }) } });
  await b.click('add'); await fill(b, { amount: '540', category: 'supplies', notes: 'Stock' }); await b.click('review-add'); await b.click('save'); await b.click('close');
  assert.equal(b.sent('expense_void_v1').length, 0); assert.doesNotMatch(b.html(), /E_sheet/);
});
test('E edit: prefilled, reason required, only the changed keys go to v2; a system-priced stock row shows a read-only amount', async () => {
  const b = await boot({ rpc: { admin_save_transaction_v2: () => ({ ok: true, id: 'r1' }) } });
  await b.click('open', 'r1'); await b.click('edit'); assert.match(b.html(), /value="1200\.00"/); assert.match(b.html(), /Why the change\?/);
  await b.type('amount', '1250'); await b.click('edit-save'); assert.equal(b.sent('admin_save_transaction_v2').length, 0); assert.match(b.text(), /Say why you are changing it/);
  await b.type('reason', 'Typo'); await b.click('edit-save');
  assert.deepEqual(b.sent('admin_save_transaction_v2')[0][1].p_txn, { id: 'r1', gross_amount: '1250.00', reason: 'Typo' });
  await b.click('open', 'r3'); await b.click('edit'); assert.match(b.html(), /class="E_input E_ro" id="E_amt">₱540\.00/); assert.match(b.html(), /Change the price in Inventory/); assert.doesNotMatch(b.html(), /data-f="amount"/);
});
test('E void and review: a reason of 3+ characters; Not a cost and Same purchase use expense_void_v1; Count it uses the existing review call', async () => {
  const b = await boot({ rpc: { expense_void_v1: () => ({ ok: true }), admin_review_transaction_v1: () => ({ ok: true }) } });
  await b.click('open', 'r1'); await b.click('void-ask'); await b.click('void-go'); assert.equal(b.sent('expense_void_v1').length, 0);
  await b.type('reason', 'ab'); await b.click('void-go'); assert.equal(b.sent('expense_void_v1').length, 0); await b.type('reason', 'Duplicate entry'); await b.click('void-go');
  assert.deepEqual(b.sent('expense_void_v1')[0][1], { p_property_id: PROP, p_id: 'r1', p_reason: 'Duplicate entry' });
  await b.click('open', 'p1'); await b.click('review'); assert.match(b.text(), /Count it/); assert.match(b.text(), /Same purchase as Stock 21 Nov/); assert.match(b.text(), /Not a cost/);
  await b.click('count'); assert.deepEqual(b.sent('admin_review_transaction_v1')[0][1], { p_property_id: PROP, p_id: 'p1', p_action: 'approve', p_edits: {}, p_reason: null });
  await b.click('open', 'p1'); await b.click('review'); await b.click('same-as'); assert.equal(b.sent('expense_void_v1')[1][1].p_same_as, 'r3');
  await b.click('open', 'p2'); await b.click('review'); await b.click('not-cost'); assert.deepEqual(b.sent('expense_void_v1')[2][1], { p_property_id: PROP, p_id: 'p2', p_reason: 'Not a cost' });
});
test('E locked rows: view-only, with the way to the screen that owns them', async () => {
  const b = await boot({ payUrl: () => './pay/admin.html#tasks=0&cal=0', screen: SCREEN({ rows: [ROW({ id: 's1', chip: 'staff_pay', locked: true, amount_locked: true, receipt_can: { add: false, replace: false, remove: false } }), ROW({ id: 'b1', chip: 'bill', locked: true, amount_locked: true, has_receipt: true, receipt_ref: { kind: 'bill', id: 'b1', mime: 'image/jpeg' }, receipt_can: { add: false, replace: false, remove: false } })] }) });
  await b.click('open', 's1'); let h = b.html(); assert.match(h, /Proof is in Pay staff/); assert.match(h, /<a class="btn btn-secondary btn-block" href="\.\/pay\/admin\.html#tasks=0&amp;cal=0">Open Pay staff<\/a>/); assert.doesNotMatch(h, /Add receipt|E_rblock/); assert.doesNotMatch(h, /data-e="void-ask"/);
  await b.click('open', 'b1'); h = b.html(); assert.match(h, /Payment screenshot from Bills/); assert.match(h, /Open in Bills/); assert.doesNotMatch(h, /data-e="rc-ask"|data-e="chooser"/);
  assert.ok(b.client.fns.every((f) => f[1].mode === 'sign'), 'only a sign request is ever made here');
});

// ------------------------------------------------------------------------------------------------ receipts
test('E receipts: a signed link is asked for only in the row sheet, one id, mode sign; nothing is stored or logged', async () => {
  const b = await boot({ screen: SCREEN({ rows: [ROW({ id: 'a1', has_receipt: true, receipt_ref: { kind: 'txn', id: 'a1', mime: 'image/jpeg' }, receipt_can: { add: false, replace: true, remove: true } })] }), fn: { sign: () => ({ ok: true, links: { a1: { url: 'https://x.supabase.co/signed/a1?token=T', kind: 'txn', mime: 'image/jpeg' } } }) } });
  assert.equal(b.client.fns.length, 0, 'nothing is signed for the list'); assert.doesNotMatch(b.html(), /token=/);
  await b.click('open', 'a1'); assert.deepEqual(b.client.fns, [['ocr-receipt', { mode: 'sign', property_id: PROP, ids: ['a1'] }]]);
  assert.match(b.html(), /href="https:\/\/x\.supabase\.co\/signed\/a1\?token=T"/); assert.match(b.html(), /data-e="chooser">Replace/); assert.match(b.html(), /data-e="rc-ask">Remove/);
  await b.click('close'); assert.doesNotMatch(b.html(), /token=/, 'the link goes with the sheet');
  assert.doesNotMatch(SRC, /localStorage|sessionStorage|console\.|\.storage\b|createSignedUrl|caches\./);
  assert.match(SRC, /for \(i = 0; i < ids\.length; i \+= 20\)/);
});
test('E receipts: Add receipt on an existing row attaches, then sets, then refreshes; the buttons follow receipt_can', async () => {
  let n = 0;
  const b = await boot({ shrinkImage: SHRINK, fn: { attach: () => ATTACH(), sign: () => ({ ok: true, links: {} }) }, rpc: { expense_receipt_set_v1: () => ({ ok: true, id: 'r1', has_receipt: true, receipt_ref: { kind: 'txn', id: 'r1', mime: 'image/jpeg' } }), expenses_screen_v1: () => (++n === 1 ? SCREEN() : SCREEN({ rows: [ROW({ has_receipt: true })] })) } });
  await b.click('open', 'r1'); assert.match(b.html(), /Add receipt/); assert.doesNotMatch(b.html(), /Replace|Remove<\/button>/);
  await b.click('chooser'); assert.match(b.html(), /Take photo/); assert.match(b.html(), /accept="image\/\*" capture/); assert.match(b.html(), /Choose photo or PDF/); assert.match(b.html(), /accept="image\/\*,application\/pdf"/); assert.match(b.html(), /One receipt per expense\. PDF up to 5 MB\./);
  await b.pick(JPG);
  const order = [...b.client.fns.map((f) => 'fn:' + f[1].mode), ...[]];
  assert.deepEqual(b.client.fns.filter((f) => f[1].mode !== 'sign').map((f) => f[1].mode), ['attach']); assert.deepEqual(b.client.fns[0][1], { mode: 'attach', file_base64: 'QUJD', mime_type: 'image/jpeg' });
  assert.deepEqual(b.sent('expense_receipt_set_v1')[0][1], { p_property_id: PROP, p_id: 'r1', p_path: 'tx/abc.jpg', p_reason: 'Receipt added' });
  assert.ok(order.indexOf('fn:attach') >= 0); assert.ok(b.sent('expenses_screen_v1').length >= 2, 'the row refreshes');
  assert.match(b.text(), /Receipt says ₱1,250\.00, this row says ₱1,200\.00 Use receipt amount/);
});
test('E receipts: applying the suggestion sends exactly the id, the amount and a reason', async () => {
  const b = await boot({ shrinkImage: SHRINK, fn: { attach: () => ATTACH(), sign: () => ({ ok: true, links: {} }) }, rpc: { expense_receipt_set_v1: () => ({ ok: true, id: 'r1', has_receipt: true, receipt_ref: { kind: 'txn', id: 'r1', mime: 'image/jpeg' } }), admin_save_transaction_v2: () => ({ ok: true, id: 'r1' }) } });
  await b.click('open', 'r1'); await b.pick(JPG); await b.click('sug');
  assert.deepEqual(b.sent('admin_save_transaction_v2')[0][1].p_txn, { id: 'r1', gross_amount: '1250.00', reason: 'Amount from receipt' });
  assert.deepEqual(Object.keys(b.sent('admin_save_transaction_v2')[0][1]).sort(), ['p_idempotency_key', 'p_property_id', 'p_txn']);
});
test('E receipts: a matching amount says so; a system-priced row shows no suggestion', async () => {
  let b = await boot({ shrinkImage: SHRINK, fn: { attach: () => ATTACH({ suggest: { amount: 1200 } }), sign: () => ({ ok: true, links: {} }) }, rpc: { expense_receipt_set_v1: () => ({ ok: true, id: 'r1', has_receipt: true, receipt_ref: { kind: 'txn', id: 'r1', mime: 'image/jpeg' } }) } });
  await b.click('open', 'r1'); await b.pick(JPG); assert.match(b.text(), /Receipt matches this row/); assert.doesNotMatch(b.html(), /data-e="sug"/);
  b = await boot({ shrinkImage: SHRINK, fn: { attach: () => ATTACH(), sign: () => ({ ok: true, links: {} }) }, rpc: { expense_receipt_set_v1: () => ({ ok: true, id: 'r3', has_receipt: true, receipt_ref: { kind: 'txn', id: 'r3', mime: 'image/jpeg' } }) } });
  await b.click('open', 'r3'); await b.pick(JPG); assert.doesNotMatch(b.html(), /data-e="sug"|Receipt matches/);
});
test('E receipts: Remove asks for a reason and sends null with it; Replace sends the new path', async () => {
  const withRc = ROW({ id: 'a1', has_receipt: true, receipt_ref: { kind: 'txn', id: 'a1', mime: 'image/jpeg' }, receipt_can: { add: false, replace: true, remove: true } });
  const b = await boot({ screen: SCREEN({ rows: [withRc] }), shrinkImage: SHRINK, fn: { attach: () => ATTACH(), sign: () => ({ ok: true, links: {} }) }, rpc: { expense_receipt_set_v1: () => ({ ok: true, id: 'a1', has_receipt: false, receipt_ref: null }) } });
  await b.click('open', 'a1'); await b.click('rc-ask'); assert.match(b.text(), /Remove this receipt\? The file is kept\./);
  await b.click('rc-go'); assert.equal(b.sent('expense_receipt_set_v1').length, 0); await b.type('reason', 'ab'); await b.click('rc-go'); assert.equal(b.sent('expense_receipt_set_v1').length, 0);
  await b.type('reason', 'Wrong picture'); await b.click('rc-go'); assert.deepEqual(b.sent('expense_receipt_set_v1')[0][1], { p_property_id: PROP, p_id: 'a1', p_path: null, p_reason: 'Wrong picture' });
  await b.click('open', 'a1'); await b.pick(JPG); assert.equal(b.sent('expense_receipt_set_v1')[1][1].p_path, 'tx/abc.jpg'); assert.equal(b.sent('expense_receipt_set_v1')[1][1].p_reason, 'Receipt replaced');
});
test('E receipts: refusals are plain; a duplicate names where the receipt already is', async () => {
  const mk = (res) => boot({ shrinkImage: SHRINK, fn: { attach: () => ATTACH(), sign: () => ({ ok: true, links: {} }) }, rpc: { expense_receipt_set_v1: () => res } });
  let b = await mk({ ok: false, error: 'duplicate_receipt', ref: 'Stock bought 21 Nov' }); await b.click('open', 'r1'); await b.pick(JPG); assert.match(b.text(), /This receipt is already on Stock bought 21 Nov\./);
  b = await mk({ ok: false, error: 'locked', where: 'Pay staff' }); await b.click('open', 'r1'); await b.pick(JPG); assert.match(b.text(), /kept in Pay staff/);
  b = await mk({ ok: false, error: 'receipt_in_use' }); await b.click('open', 'r1'); await b.pick(JPG); assert.match(b.text(), /This receipt is already in Inventory\./);
  b = await mk({ data: null, error: { code: '23505', message: 'duplicate key' } }); await b.click('open', 'r1'); await b.pick(JPG); assert.match(b.text(), /This receipt is already on another expense\./);
});
test('E receipts: a PDF is never shrunk, over 5 MB is refused, a wrong type is refused, and a PDF says it cannot be read', async () => {
  let shrinks = 0; const pdf = { name: 'r.pdf', type: 'application/pdf', size: 1000 };
  const b = await boot({ sub: 'add', shrinkImage: () => { shrinks++; return SHRINK(); }, readFile: () => Promise.resolve({ base64: 'UERG', mime: 'application/pdf' }), fn: { attach: (x) => ATTACH({ mime: 'application/pdf', suggest: null, unread: 'pdf' }) } });
  await b.pick({ ...pdf, size: 5 * 1024 * 1024 + 1 }); assert.match(b.text(), /That file is over 5 MB\./); await b.pick({ name: 'a.txt', type: 'text/plain', size: 10 }); assert.match(b.text(), /Use a photo or a PDF\./);
  assert.equal(b.client.fns.length, 0, 'nothing is uploaded for a refused file');
  await b.pick(pdf); assert.equal(shrinks, 0); assert.deepEqual(b.client.fns[0][1], { mode: 'attach', file_base64: 'UERG', mime_type: 'application/pdf' });
  assert.match(b.text(), /Attached\. A PDF can’t be read - fill in the fields\./); assert.match(b.text(), /Receipt attached \(PDF\)/); assert.match(b.html(), /E_pdf/);
});
test('E receipts: a photo on the Add sheet prefills and marks the fields, and the create carries the receipt fields (the edit never does)', async () => {
  const b = await boot({ sub: 'add', shrinkImage: SHRINK, fn: { attach: () => ATTACH() }, rpc: { admin_save_transaction_v2: () => ({ ok: true, id: 'n1' }) } });
  await b.pick(JPG); assert.match(b.html(), /value="1250\.00"/); assert.match(b.html(), /check this/); assert.match(b.html(), /Receipt attached/);
  await b.click('review-add'); assert.match(b.html(), /<img src="blob:thumb"/, 'the review step shows the receipt'); await b.click('save'); const t = b.sent('admin_save_transaction_v2')[0][1].p_txn;
  assert.equal(t.receipt_image_path, 'tx/abc.jpg'); assert.equal(t.ocr_confidence, 0.9); assert.equal(t.gross_amount, '1250.00'); assert.equal(t.transaction_date, '2026-11-20'); assert.equal(t.payee_name, 'Sample Hardware');
});
test('E add: a 23505 on save reads as a duplicate receipt, and a refused attach saves nothing', async () => {
  let b = await boot({ sub: 'add', rpc: { admin_save_transaction_v2: () => ({ data: null, error: { code: '23505', message: 'duplicate' } }) } });
  await fill(b, { amount: '10', category: 'supplies', notes: 'x' }); await b.click('review-add'); await b.click('save'); assert.match(b.text(), /This receipt is already on another expense\./);
  b = await boot({ sub: 'add', shrinkImage: SHRINK, fn: { attach: () => ({ error: { context: { status: 500, json: () => Promise.resolve({ ok: false, error: 'hash_failed' }) } } }) } });
  await b.pick(JPG); assert.match(b.text(), /could not be saved just now/); assert.equal(b.sent('admin_save_transaction_v2').length, 0);
});

// ------------------------------------------------------------------------------------------------ hand-off to Inventory
test('E hand-off: the routing line is for owner and admin only, never on an existing row; tapping it saves nothing and uploads nothing more', async () => {
  const mk = (role) => boot({ role, sub: 'add', shrinkImage: SHRINK, fn: { attach: () => ATTACH({ stock_hint: { count: 2, names: ['Soap', 'Towels'] } }) } });
  let b = await mk('owner'); assert.doesNotMatch(b.html(), /Did this go into stock/, 'no receipt yet'); await b.pick(JPG); assert.match(b.html(), /Did this go into stock\? Add it in Inventory instead/);
  const upBefore = b.client.fns.length; await b.click('route');
  assert.equal(b.sent('admin_save_transaction_v2').length, 0); assert.equal(b.client.fns.length, upBefore, 'no second upload'); assert.deepEqual(b.nav, ['#supply'], 'no path in the address');
  assert.deepEqual(plain(b.win.CS_receiptHand), { path: 'tx/abc.jpg', mime: 'image/jpeg', from: 'expenses' }); assert.equal(b.E._held().f.category, 'supplies', 'the form is kept for the way back');
  b = await mk('admin'); await b.pick(JPG); assert.match(b.html(), /Did this go into stock/);
  b = await mk('finance'); await b.pick(JPG); assert.doesNotMatch(b.html(), /Did this go into stock/);
  b = await boot({ fn: { attach: () => ATTACH({ stock_hint: { count: 2, names: [] } }), sign: () => ({ ok: true, links: {} }) }, shrinkImage: SHRINK, rpc: { expense_receipt_set_v1: () => ({ ok: true, id: 'r1', has_receipt: true, receipt_ref: { kind: 'txn', id: 'r1', mime: 'image/jpeg' } }) } });
  await b.click('open', 'r1'); await b.pick(JPG); assert.doesNotMatch(b.html(), /Did this go into stock/);
});
test('E hand-off: after a failed hand-off the form comes back with the same receipt and fields; any other mount clears it', async () => {
  const env = loadModule(), shrinkImage = SHRINK;
  const mountIt = async (sub) => { const el = new FakeEl(), c = fakeClient({ rpc: { expenses_screen_v1: () => SCREEN() }, fn: { attach: () => ATTACH({ stock_hint: { count: 1, names: [] } }) } }), nav = [];
    env.E.mount(el, { client: c, role: 'owner', sub, propertyId: PROP, navigate: (h) => nav.push(h), toast() {}, haptic() {}, shrinkImage }); await tick();
    const fire = async (t, ev) => { for (const f of el.l[t] || []) f(ev); await tick(); }, tg = (a, x = {}) => { const t = { ...x, getAttribute: (k) => (k in a ? a[k] : null), closest: (s) => { const m = /^\[([\w-]+)\]$/.exec(s); return m && m[1] in a ? t : null; } }; return t; };
    return { el, c, nav, click: (act) => fire('click', { type: 'click', target: tg({ 'data-e': act }) }), type: (f, v) => fire('input', { type: 'input', target: tg({ 'data-f': f }, { value: v }) }), pick: (file) => fire('change', { type: 'change', target: tg({ 'data-e': 'file' }, { files: [file] }) }) }; };
  let m = await mountIt('add'); await m.pick(JPG); await m.type('amount', '77'); await m.type('notes', 'Soap'); await m.click('route'); assert.ok(env.E._held());
  m = await mountIt('add/back'); assert.match(m.el.innerHTML, /value="77"/); assert.match(m.el.innerHTML, /value="Soap"/); assert.match(m.el.innerHTML, /Receipt attached/); assert.equal(m.c.fns.filter((f) => f[1].mode === 'attach').length, 0, 'the same file, not uploaded again'); assert.equal(env.E._held(), null);
  m = await mountIt('add'); await m.pick(JPG); await m.click('route'); assert.ok(env.E._held()); await mountIt(''); assert.equal(env.E._held(), null, 'a plain mount clears it'); assert.equal(env.win.CS_receiptHand, null);
});
test('S110: Inventory takes the receipt path once, makes the draft without a second upload, and a failure offers "Back to the expense"', async () => {
  const S = read('stock/S110_supply.js');
  assert.match(S, /var hd = root\.CS_receiptHand; if \(!S\.use && hd && hd\.from === 'expenses' && typeof hd\.path === 'string' && hd\.path && S\.client\)/); assert.match(S, /root\.CS_receiptHand = null/);
  assert.match(S, /body: \{ mode: 'supply', receipt_path: path \}/); assert.match(S, /Couldn’t open this in Inventory\./); assert.match(S, /data-sact="hand-back">Back to the expense/); assert.match(S, /navigate\('#expenses\/add\/back'\)/);
  // run it: a hand-off arrives, supply is asked with the path only, then the draft is read
  const win = { root: null }; const calls = [], rpcs = []; const ctx = { window: win, console, Promise, Date, Math, JSON, setTimeout, clearTimeout, Intl, Uint8Array };
  ctx.root = ctx; win.CS_receiptHand = undefined; const mod = fs.readFileSync(path.join(root, 'stock/S110_supply.js'), 'utf8');
  assert.doesNotMatch(mod, /receipt_path: path[^}]*image_base64/);
});

// ------------------------------------------------------------------------------------------------ Manage, KPIs, shell, styles
test('N_manage: no second expense form; the Log an expense button opens #expenses/add', () => {
  assert.match(MAN, /<a class="btn btn-primary btn-block" href="#expenses\/add">Log an expense<\/a>/);
  for (const gone of ["kind === 'expense'", 'scanReceipt', 'shrinkReceipt', 'doExpenseSend', 'expenseTxn', 'validateExpense', 'scan-pick', "mode: 'extract'", 'admin_save_transaction_v1', 'N_xs']) assert.ok(!MAN.includes(gone), gone + ' is gone from Manage');
  assert.doesNotMatch(APP, /Inquiries, expenses and key figures/); assert.match(APP, /sub: 'Inquiries and key figures'/);
});
test('KPI copy (SPEC 8.4): labels follow kpi_source, the pending line and the See expenses link, no new keys leak to non-admins', async () => {
  const win = { ICON: () => '', document: {} }; win.window = win; vm.runInContext(read('kpi/K_kpi.js'), vm.createContext(win));
  const mk = (admin, role = 'owner') => { const L = {}, e = { innerHTML: '', addEventListener: (t, f) => { (L[t] ||= []).push(f); }, removeEventListener() {}, querySelector: () => null };
    win.K_Kpi.reset(); win.K_Kpi.mount(e, { client: { rpc: (n) => Promise.resolve(n === 'kpi_tab_v1' ? { data: { ok: true, month: '2026-11-01', utility: {}, inventory: {}, admin }, error: null } : { data: [], error: null }) }, role, propertyId: 'p' }); e.go = async () => { const g = { getAttribute: (n) => ({ 'data-kact': 'seg', 'data-seg': 'admin' })[n] ?? null, closest: () => g }; for (const f of L.click || []) f({ target: g, preventDefault() {} }); await tick(); }; return e; };
  const A = { supplies_month: 3000, supply_cost_per_turnover: 500, cleaning_pay_month: 1500, net_month: 9000, revenue_month: 20000, costs_month: 11000, month_kwh_cost: 100 };
  let e = mk({ ...A, kpi_source: 'legacy', costs_pending_month: { count: 2, total: 1850 }, cleaning_pay_open: 600 }); await tick(); await e.go();
  let t = e.innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.match(t, /Supplies bought Earlier months: from stock receipts/, 'no month name when the server sent no cut-over month'); assert.match(t, /Supplies used per turnover/); assert.doesNotMatch(t, /Supply cost per turnover/);
  assert.doesNotMatch(t, /Cleaning fees for cleans this month/, 'that line belongs to the ledger source only');
  e = mk({ ...A, kpi_source: 'legacy', kpi_ledger_from: '2026-12' }); await tick(); await e.go(); assert.match(e.innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '), /Supplies bought Before December: from stock receipts/);
  e = mk({ ...A, kpi_source: 'ledger', cleaning_pay_open: 600 }); await tick(); await e.go(); assert.match(e.innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '), /Cleaning pay Cleaning fees for cleans this month · ₱600 requested, not paid yet/); assert.doesNotMatch(e.innerHTML, /from stock receipts/);
  e = mk({ ...A, kpi_source: 'legacy', costs_pending_month: { count: 2, total: 1850 }, cleaning_pay_open: 600 }); await tick(); await e.go(); t = e.innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '); assert.match(t, /₱1,850 of expenses waiting for review/); assert.match(t, /See expenses/); assert.match(e.innerHTML, /href="#expenses"/);
  e = mk({ ...A, kpi_source: 'ledger', costs_pending_month: { count: 0, total: 0 }, cleaning_pay_open: 0 }); await tick(); await e.go(); t = e.innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.doesNotMatch(t, /Before November|Earlier months/); assert.doesNotMatch(t, /requested, not paid yet/); assert.doesNotMatch(t, /waiting for review/); assert.match(t, /See expenses/);
  e = mk({ ...A, kpi_source: 'ledger' }, 'cleaner'); await tick(); assert.doesNotMatch(e.innerHTML, /expenses|Supplies bought/);
});
test('Shell: version, cache name, service worker list, no peso in a staff layout, nothing signed is cached', () => {
  const pkg = JSON.parse(read('package.json')); assert.equal(pkg.version, '3.4.53'); assert.match(APP, /version: '3\.4\.53'/);
  assert.match(SW, /const CACHE_NAME = 'cs-shell-v78'/); assert.match(APP, /var PC_SHELL = 'cs-shell-v78'/);
  assert.ok(SW.includes("'./expenses/E_expenses.js', './expenses/E_expenses.css'")); assert.match(SW, /NETWORK_ONLY_HOSTS = \['supabase\.co'/);
  assert.match(SW, /\/storage\/v1\//); assert.match(read('README.md'), /cs-shell-v78/);
  // the Today card is drawn only for the admin layout and only by A_expCard (the staff body never calls it)
  const staffBody = APP.slice(APP.indexOf("body = '<div class=\"A_body\">'") - 400, APP.indexOf("body = '<div class=\"A_body\">'") + 40);
  assert.equal((APP.match(/A_expCard\(\)/g) || []).length, 2, 'defined once, used once'); assert.ok(!/A_expCard/.test(staffBody));
  const card = APP.slice(APP.indexOf('function A_expCard'), APP.indexOf('function A_loadExpenses'));
  assert.match(card, /state\.layout !== 'admin'/); assert.match(card, /EXPENSES · /); assert.match(card, /Usual month about /); assert.match(card, / to review/); assert.match(card, /href="#expenses\/add"/);
  assert.doesNotMatch(read('index.html'), /A_expCard/); assert.match(read('index.html'), /id="v-expenses"/);
});
test('Today card: the month, a usual month rounded to 100, a review count only when something waits, an Add button only with write access', async () => {
  const { A_expCardForTest } = {}; void A_expCardForTest;
  const card = APP.slice(APP.indexOf('function A_expCard'), APP.indexOf('function A_loadExpenses'));
  const fnc = new Function('state', 'role', 'esc', 'A_peso', 'ICON', card + '; return A_expCard;');
  const mk = (e, layout = 'admin', r = 'owner') => fnc({ expenses: e, layout }, () => r, (s) => String(s), (x) => '₱' + Number(x).toLocaleString('en-PH'), () => '+')();
  const base = { month: '2026-11-01', total: 38420.4, basis: 47413, pending: { count: 2, total: 1850 }, can_write: true };
  let h = mk(base); assert.match(h, /EXPENSES · NOVEMBER/); assert.match(h, /₱38,420/); assert.match(h, /Usual month about ₱47,400<\/a> · <a class="E_trev" href="#expenses\/review">2 to review<\/a>/); assert.match(h, /class="btn btn-primary E_tadd" href="#expenses\/add"/);
  h = mk({ ...base, pending: { count: 0, total: 0 }, can_write: false }); assert.doesNotMatch(h, /to review/); assert.doesNotMatch(h, /E_tadd/);
  assert.equal(mk(null), ''); assert.equal(mk(base, 'staff'), ''); assert.equal(mk(base, 'admin', 'cleaner'), ''); assert.equal(mk(base, 'admin', 'laundry'), '');
  assert.match(STY, /\.E_today \.E_tadd \{ width: 64px; min-height: var\(--v5-touch\)/);
});
test('Styles: tokens only, no raw colour, no pixel font size, and only the four type tokens', () => {
  for (const [name, css] of [['E_expenses.css', CSS], ['Today card block', STY.slice(STY.indexOf('s134 (3.4.53)'))]]) {
    assert.doesNotMatch(css.replace(/\/\*[^]*?\*\//g, ''), /#[0-9a-fA-F]{3,8}\b/, name + ' has a raw hex colour'); assert.doesNotMatch(css, /rgba?\(|hsla?\(/, name + ' has a raw colour function');
    assert.doesNotMatch(css, /font-size:\s*[\d.]+px/, name); assert.doesNotMatch(css, /font:[^;]*\b\d+(\.\d+)?px/, name + ' sets a px font');
    const sizes = new Set([...css.matchAll(/font(?:-size)?:[^;]*?var\((--v5-t-[a-z0-9-]+)\)/g)].map((m) => m[1])); for (const s of sizes) assert.ok(['--v5-t-min', '--v5-t-label', '--v5-t-body', '--v5-t-num'].includes(s), name + ' uses ' + s);
  }
  assert.equal((CSS.replace(/\/\*[^]*?\*\//g, '').match(/--v5-warn-t/g) || []).length, 1, '--warn-t only on the waiting-for-review line'); assert.match(CSS, /\.E_warnline[^}]*var\(--v5-warn-t\)/);
  assert.match(CSS, /\.E_num \{ font: 400 var\(--v5-t-num\)\/1\.1 var\(--v5-font-display\)/);
});
test('Module hygiene: plain script, no network but the client, no peso outside the module (staff layout), no eval', () => {
  assert.doesNotThrow(() => new vm.Script(SRC)); assert.doesNotMatch(SRC, /\beval\(|new Function|document\.write|fetch\(|XMLHttpRequest/);
  assert.doesNotMatch(APP.slice(0, APP.indexOf('function A_expCard')).split('\n').filter((l) => /staffBody|cleaner/.test(l) && /A_expCard/.test(l)).join('\n'), /A_expCard/);
});

// ------------------------------------------------------------------------------------------------ fix round 1 (Opus r1 audit, items 1-16)
import { createRequire } from 'node:module';
const demoMod = createRequire(import.meta.url)('../demo.js');
// a second mount on the same module (what the shell does when the address changes): returns a driver for the new element
function remount(b, sub, extra = {}) {
  const el = new FakeEl(); let n = 100, nav = []; b.E.mount(el, { client: b.client, role: 'owner', sub, propertyId: PROP, navigate: (h) => nav.push(h), toast() {}, haptic() {}, newKey: (p) => `${p}-9${String(++n).padStart(8, '0')}`, ...extra });
  const fire = async (t, ev) => { for (const f of el.l[t] || []) f(ev); await tick(); }, tg = (a, x = {}) => { const t = { ...x, getAttribute: (k) => (k in a ? a[k] : null), closest: (s) => { const m = /^\[([\w-]+)\]$/.exec(s); return m && m[1] in a ? t : null; } }; return t; };
  return { el, nav, tick, html: () => el.innerHTML, text: () => el.innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '), click: (act, id) => fire('click', { type: 'click', target: tg({ 'data-e': act, ...(id !== undefined ? { 'data-id': id } : {}) }) }), type: (f, v) => fire('input', { type: 'input', target: tg({ 'data-f': f }, { value: v }) }) };
}
const LOOK = { id: 'r3', date: '2026-11-21', amount: '540.00', chip: 'stock' };
const SAVE_LOOK = { admin_save_transaction_v2: () => ({ ok: true, id: 'n9', lookalike: LOOK }), expense_void_v1: () => ({ ok: true, id: 'n9', status: 'void' }) };

test('fix 1: the same-purchase prompt survives the move off #expenses/add, on every way in', async () => {
  // Today "+ Add" and Manage "Log an expense" both land on #expenses/add
  let b = await boot({ sub: 'add', rpc: SAVE_LOOK });
  await fill(b, { amount: '540', category: 'supplies', notes: 'Stock' }); await b.click('review-add'); await b.click('save');
  assert.match(b.text(), /Saved\. Same as Stock 21 Nov \(₱540\.00\)\?/, 'the prompt is up straight away'); assert.ok(b.nav.includes('#expenses'), 'the address moved off /add');
  const m = remount(b, ''); await m.tick(); assert.match(m.text(), /Saved\. Same as Stock 21 Nov \(₱540\.00\)\?/, 'and after the remount the shell does');
  await m.click('same-yes'); assert.deepEqual(b.sent('expense_void_v1')[0][1], { p_property_id: PROP, p_id: 'n9', p_reason: 'Same purchase as Stock 21 Nov (₱540.00)', p_same_as: 'r3' });
  assert.doesNotMatch(m.html(), /E_sheet/, 'answered once, gone');
  const again = remount(b, ''); assert.doesNotMatch(again.html(), /Same as/, 'a later mount never shows an old prompt');
  // a prompt that nobody remounted for is not shown ten seconds later
  b = await boot({ sub: 'add', rpc: SAVE_LOOK }); await fill(b, { amount: '540', category: 'supplies', notes: 'Stock' }); await b.click('review-add'); await b.click('save');
  b.E._setClock(() => NOW + 11000); assert.doesNotMatch(remount(b, '').html(), /Same as/);
  // the way back from Inventory (#expenses/add/back)
  b = await boot({ sub: 'add', shrinkImage: SHRINK, rpc: SAVE_LOOK, fn: { attach: () => ATTACH({ stock_hint: { count: 1, names: [] } }) } });
  await b.pick(JPG); await b.click('route'); assert.ok(b.E._held());
  const back = remount(b, 'add/back', { shrinkImage: SHRINK }); await back.tick(); assert.match(back.html(), /Review and save/);
  await back.click('review-add'); await back.click('save'); assert.match(back.text(), /Saved\. Same as Stock 21 Nov/); assert.ok(back.nav.includes('#expenses'));
  assert.match(remount(b, '').text(), /Same as Stock 21 Nov/);
  // from the list's own Add button there is no move at all
  b = await boot({ rpc: SAVE_LOOK }); await b.click('add'); await fill(b, { amount: '540', category: 'supplies', notes: 'Stock' }); await b.click('review-add'); await b.click('save');
  assert.match(b.text(), /Same as/); assert.deepEqual(b.nav, []);
  // in-page Add, answer No, remount inside ten seconds: nothing comes back
  b = await boot({ sub: 'add', rpc: SAVE_LOOK }); await fill(b, { amount: '540', category: 'supplies', notes: 'Stock' }); await b.click('review-add'); await b.click('save');
  await b.click('close'); assert.doesNotMatch(remount(b, '').html(), /Same as/, 'answered No: no prompt on a quick remount');
  // a plain in-page Add (no /add route) never carries a prompt either
  b = await boot({ rpc: SAVE_LOOK }); await b.click('add'); await fill(b, { amount: '540', category: 'supplies', notes: 'Stock' }); await b.click('review-add'); await b.click('save');
  assert.doesNotMatch(remount(b, '').html(), /Same as/, 'only the /add route carries the prompt');
});

test('fix 2: the moved form keeps the old one: order, labels, a review step, check-this marks, hard-to-read warning, the server date rule', async () => {
  const b = await boot({ sub: 'add', shrinkImage: SHRINK, fn: { attach: () => ATTACH({ suggest: { amount: 1250, date: '2026-11-20', vendor: 'Sample Hardware', category: 'supplies', line_items: [{ description: 'Bulbs' }], confidence: 0.5 } }) }, rpc: { admin_save_transaction_v2: () => ({ ok: true, id: 'n1' }) } });
  const h0 = b.html(), at = (t) => h0.indexOf('>' + t); assert.ok(at('Date') > 0 && at('Date') < at('Amount (PHP)') && at('Amount (PHP)') < at('Category') && at('Category') < at('What was it for?') && at('What was it for?') < at('Paid to (optional)'), 'Date, Amount (PHP), Category, What was it for?, Paid to (optional)');
  assert.match(h0, /max="2026-11-24"/, 'the date picker stops at Manila tomorrow'); assert.match(h0, /Review and save/); assert.doesNotMatch(h0, /data-e="save"/);
  await b.pick(JPG); assert.match(b.html(), /<span class="E_mark">check this<\/span>/); assert.match(b.html(), /The photo was hard to read\. Please check every figure\./);
  await b.type('date', '2026-11-25'); await b.click('review-add'); assert.match(b.text(), /The date can’t be later than tomorrow\./); assert.equal(b.sent('admin_save_transaction_v2').length, 0);
  await b.type('date', '2026-11-24'); await b.click('review-add'); assert.match(b.text(), /Check this before you save\. It is counted in the books at once\./); assert.match(b.text(), /Tue 24 Nov 2026/); assert.match(b.text(), /Save expense/); assert.equal(b.sent('admin_save_transaction_v2').length, 0);
  await b.click('add-back'); assert.match(b.html(), /Review and save/); assert.match(b.html(), /value="2026-11-24"/, 'Back keeps what was typed');
  await b.click('review-add'); await b.click('save'); assert.equal(b.sent('admin_save_transaction_v2').length, 1); assert.equal(b.sent('admin_save_transaction_v2')[0][1].p_txn.transaction_date, '2026-11-24'); assert.equal(b.sent('admin_save_transaction_v2')[0][1].p_idempotency_key, 'exp-add-000000000000000000000001');
  const ok = await boot({ sub: 'add', shrinkImage: SHRINK, fn: { attach: () => ATTACH() } }); await ok.pick(JPG); assert.doesNotMatch(ok.html(), /hard to read/, 'a clear scan has no warning');
  // a refusal sends the person back to the form with a fresh key; a dropped connection keeps the review step so a repeat is safe
  let r = await boot({ sub: 'add', rpc: { admin_save_transaction_v2: () => ({ ok: false, error: 'future_date' }) } }); await fill(r, { amount: '5', category: 'supplies', notes: 'x' }); await r.click('review-add'); await r.click('save');
  assert.match(r.text(), /The date can’t be later than tomorrow\./); assert.match(r.html(), /Review and save/);
  r = await boot({ sub: 'add', rpc: { admin_save_transaction_v2: () => ({ data: null, error: { message: 'Failed to fetch' } }) } }); await fill(r, { amount: '5', category: 'supplies', notes: 'x' }); await r.click('review-add'); await r.click('save');
  assert.match(r.html(), /data-e="save"/, 'still on the check step'); await r.click('save'); assert.equal(r.sent('admin_save_transaction_v2')[1][1].p_idempotency_key, r.sent('admin_save_transaction_v2')[0][1].p_idempotency_key, 'a repeat reuses the key');
});

test('fix 3: Needs review shows the receipt and lets Amount, Category and What it was for be changed; changes ride in p_edits with a reason', async () => {
  const P1 = ROW({ id: 'pq', amount: '900.00', status: 'pending_review', chip: 'receipt', has_receipt: true, receipt_ref: { kind: 'txn', id: 'pq', mime: 'image/jpeg' }, notes: 'Bulbs', receipt_can: { add: false, replace: false, remove: false } }), Z = ROW({ id: 'pz', amount: '0.00', status: 'pending_review', chip: 'telegram', notes: 'Soap' });
  const mk = () => boot({ screen: SCREEN({ rows: [P1, Z] }), rpc: { admin_review_transaction_v1: () => ({ ok: true }) }, fn: { sign: () => ({ ok: true, links: { pq: { url: 'https://x.supabase.co/signed/pq?token=T', kind: 'txn', mime: 'image/jpeg' } } }) } });
  let b = await mk(); await b.click('open', 'pq'); await b.click('review');
  assert.match(b.html(), /id="E_ramt"[^>]*value="900\.00"/); assert.match(b.html(), /id="E_rnotes"[^>]*value="Bulbs"/); assert.match(b.html(), /<option value="supplies" selected>/);
  assert.match(b.html(), /<img class="E_img" src="https:\/\/x\.supabase\.co\/signed\/pq\?token=T"/, 'the receipt, through a signed link'); assert.deepEqual(b.client.fns.map((f) => f[1].mode), ['sign', 'sign'].slice(0, b.client.fns.length)); assert.ok(b.client.fns.length >= 1);
  await b.click('count'); assert.deepEqual(b.sent('admin_review_transaction_v1')[0][1], { p_property_id: PROP, p_id: 'pq', p_action: 'approve', p_edits: {}, p_reason: null }, 'no change, no edits, no reason');
  b = await mk(); await b.click('open', 'pq'); await b.click('review'); await b.type('amount', '950'); await b.type('notes', 'Bulbs and tape'); await b.type('category', 'cleaning', 'change');
  await b.click('count'); assert.deepEqual(b.sent('admin_review_transaction_v1')[0][1], { p_property_id: PROP, p_id: 'pq', p_action: 'approve', p_edits: { gross_amount: '950.00', category: 'cleaning', notes: 'Bulbs and tape' }, p_reason: 'Edited while counting' });
  // Count it is off until the amount is valid
  b = await mk(); await b.click('open', 'pz'); await b.click('review'); assert.match(b.html(), /data-e="count" disabled/); await b.click('count'); assert.equal(b.sent('admin_review_transaction_v1').length, 0);
  await b.type('amount', 'abc'); assert.equal(b.el.q['[data-e="count"]'].disabled, true); await b.type('amount', '12.50'); assert.equal(b.el.q['[data-e="count"]'].disabled, false, 'the keystroke switches it on');
  await b.click('count'); assert.deepEqual(b.sent('admin_review_transaction_v1')[0][1].p_edits, { gross_amount: '12.50' }); assert.equal(b.sent('admin_review_transaction_v1')[0][1].p_reason, 'Edited while counting');
  assert.equal(SRC.includes("p_edits: {}"), false, 'no hard-coded empty edits any more');
});

test('fix 4: locked rows: Open Pay staff is the external pay page; Open in Bills goes to a Bills screen that exists', async () => {
  const S1 = ROW({ id: 's1', chip: 'staff_pay', locked: true, amount_locked: true, receipt_can: { add: false, replace: false, remove: false } });
  const B1 = ROW({ id: 'b1', chip: 'bill', locked: true, amount_locked: true, has_receipt: true, receipt_ref: { kind: 'bill', id: 'bill-77', mime: 'image/jpeg' }, receipt_can: { add: false, replace: false, remove: false } });
  const B2 = ROW({ id: 'b2', chip: 'bill', locked: true, amount_locked: true, receipt_ref: null, receipt_can: { add: false, replace: false, remove: false } });
  const b = await boot({ payUrl: () => './pay/admin.html#tasks=2&cal=1', screen: SCREEN({ rows: [S1, B1, B2] }), fn: { sign: () => ({ ok: true, links: {} }) } });
  await b.click('open', 's1'); assert.match(b.html(), /<a class="btn btn-secondary btn-block" href="\.\/pay\/admin\.html#tasks=2&amp;cal=1">Open Pay staff<\/a>/); assert.doesNotMatch(b.html(), /data-e="go-pay"/);
  await b.click('open', 'b1'); await b.click('go-bills', 'b1'); assert.equal(b.nav.at(-1), '#bills/pay/bill-77', 'a Bills sub the router knows (BL_bills mount accepts pay/<id>)');
  await b.click('open', 'b2'); await b.click('go-bills', 'b2'); assert.equal(b.nav.at(-1), '#home', 'a bill that cannot be named goes to Today, never a dead address');
  const none = await boot({ screen: SCREEN({ rows: [S1] }) }); await none.click('open', 's1'); assert.doesNotMatch(none.html(), /Open Pay staff/, 'no pay page, no dead button');
  assert.match(APP, /payUrl: function \(\) \{ return LINKS\.pay \? H_payUrl\('admin\.html'\) : ''; \}/); assert.doesNotMatch(SRC, /nav\('#pay'\)|nav\('#bills'\)/);
  const BL = read('bills/BL_bills.js'); assert.match(BL, /mode === 'pay' && parts\[1\]/);
});

test('fix 5-6: S110 keeps the way back when the catalogue does not load, and says when the receipt is already in Inventory', async () => {
  const run = async (rpc, fn) => {
    const ctx = { console, Promise, Date, Math, JSON, setTimeout, clearTimeout, Intl, Uint8Array, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} } }; ctx.window = ctx; ctx.ICON = () => '';
    ctx.CS_receiptHand = { path: 'tx/abc.jpg', mime: 'image/jpeg', from: 'expenses' }; vm.createContext(ctx); vm.runInContext(read('stock/S110_supply.js'), ctx);
    const el = new FakeEl(), nav = [], c = { rpc, functions: { invoke: fn } };
    ctx.S110_Supply.mount(el, { client: c, role: 'owner', sub: '', propertyId: PROP, navigate: (h) => nav.push(h), toast() {} }); await tick(20);
    const fire = async (act) => { const t = { getAttribute: (k) => (k === 'data-sact' ? act : null), closest: () => t }; for (const f of el.l.click || []) f({ type: 'click', target: t, preventDefault() {} }); await tick(); };
    return { el, nav, ctx, text: () => el.innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '), fire };
  };
  let m = await run(() => Promise.resolve({ data: null, error: { code: 'PGRST301', message: 'boom' } }), () => Promise.resolve({ data: { ok: true, draft_id: 'd1' }, error: null }));
  assert.match(m.text(), /Couldn’t open this in Inventory\./); assert.match(m.el.innerHTML, /data-sact="hand-back">Back to the expense/); assert.equal(m.ctx.CS_receiptHand, null, 'the hand-off is read once');
  await m.fire('hand-back'); assert.deepEqual(m.nav, ['#expenses/add/back']);
  m = await run(() => Promise.reject(new Error('Failed to fetch')), () => Promise.resolve({ data: null, error: null })); assert.match(m.el.innerHTML, /Back to the expense/, 'a rejected load too');
  const cat = () => Promise.resolve({ data: { items: [{ id: 'i1', name: 'Soap', unit: 'pc', category: 'Bathroom', active: true }] }, error: null });
  m = await run(cat, () => Promise.resolve({ data: { ok: false, error: 'receipt_in_use' }, error: null })); assert.match(m.text(), /This receipt is already in Inventory\./); assert.match(m.el.innerHTML, /Back to the expense/);
  m = await run(cat, () => Promise.resolve({ data: null, error: { context: { status: 409, json: () => Promise.resolve({ ok: false, error: 'receipt_in_use' }) } } })); assert.match(m.text(), /This receipt is already in Inventory\./, 'also when it arrives as a refusal with a status');
  assert.equal(HELDSAFE(), true);
  function HELDSAFE() { return /relRcpt\(me\)/.test(read('stock/S110_supply.js').slice(read('stock/S110_supply.js').indexOf('function handFailed'))); }
});

test('fix 7: the void sheet says what it does to the month; Void and Remove stay off until a reason of three letters', async () => {
  const b = await boot({ screen: SCREEN({ rows: [ROW({ id: 'v1', amount: '540.00', date: '2026-11-22', has_receipt: true, receipt_ref: { kind: 'txn', id: 'v1', mime: 'image/jpeg' }, receipt_can: { add: false, replace: true, remove: true } })] }), fn: { sign: () => ({ ok: true, links: {} }) }, rpc: { expense_void_v1: () => ({ ok: true }) } });
  await b.click('open', 'v1'); await b.click('void-ask'); assert.match(b.text(), /This takes ₱540\.00 out of November’s costs\. It can be restored from the dashboard’s audit history\./);
  assert.match(b.html(), /data-e="void-go" disabled/); await b.type('reason', 'ab'); assert.equal(b.el.q['[data-e="void-go"]'].disabled, true); await b.type('reason', 'abc'); assert.equal(b.el.q['[data-e="void-go"]'].disabled, false);
  await b.click('void-go'); assert.equal(b.sent('expense_void_v1').length, 1);
  const c = await boot({ screen: SCREEN({ rows: [ROW({ id: 'v1', has_receipt: true, receipt_ref: { kind: 'txn', id: 'v1', mime: 'image/jpeg' }, receipt_can: { add: false, replace: true, remove: true } })] }), fn: { sign: () => ({ ok: true, links: {} }) } });
  await c.click('open', 'v1'); await c.click('rc-ask'); assert.match(c.html(), /data-e="rc-go" disabled/); await c.type('reason', 'ab'); assert.equal(c.el.q['[data-e="rc-go"]'].disabled, true); await c.type('reason', 'Wrong file'); assert.equal(c.el.q['[data-e="rc-go"]'].disabled, false);
});

test('fix 8-9: the receipt mark is a paperclip; the demo has a bill and a staff-pay row, a stock source link, and honours the cursor', async () => {
  assert.doesNotMatch(SRC, /ic\('clip'/); assert.match(read('icons.js'), /"paperclip":/);
  const b = await boot({ screen: SCREEN({ rows: [ROW({ id: 'a1', has_receipt: true, receipt_ref: { kind: 'txn', id: 'a1', mime: 'image/jpeg' } }), ROW({ id: 'a2' }), ROW({ id: 'a3', chip: 'stock', stock: { lines: 4, items: 4 }, amount_locked: true })] }), fn: { sign: () => ({ ok: true, links: {} }) } });
  assert.match(b.html(), /E_clip" aria-label="Has a receipt"><i data-ic="paperclip">/); await b.click('open', 'a2'); assert.match(b.html(), /data-ic="paperclip"/, 'Add receipt');
  await b.click('open', 'a3'); assert.match(b.text(), /Source Stock bought · 4 lines/); assert.match(b.html(), /data-e="go-items">See the items in Inventory/); await b.click('go-items'); assert.equal(b.nav.at(-1), '#stock');
  const d = demoMod.client('owner', new Date('2026-11-23T03:00:00Z')); const x = (await d.rpc('expenses_screen_v1', { p_property_id: PROP, p_limit: 100 })).data;
  assert.ok(x.rows.some((r) => r.chip === 'bill' && r.locked && r.receipt_ref && r.receipt_ref.kind === 'bill'), 'a bill row'); assert.ok(x.rows.some((r) => r.chip === 'staff_pay' && r.locked), 'a staff-pay row'); assert.ok(x.rows.some((r) => r.chip === 'stock' && r.stock), 'a stock row');
  assert.equal(x.total, x.rows.filter((r) => r.status === 'confirmed').reduce((t, r) => t + Number(r.amount), 0), 'the demo total adds up');
  const p1 = (await d.rpc('expenses_screen_v1', { p_property_id: PROP, p_limit: 2 })).data; assert.equal(p1.rows.length, 2); assert.equal(p1.more, true);
  const last = p1.rows[1], p2 = (await d.rpc('expenses_screen_v1', { p_property_id: PROP, p_limit: 100, p_before: last.created_at, p_before_id: last.id })).data;
  assert.equal(p1.rows.length + p2.rows.length, x.rows.length, 'two pages cover every row once'); assert.equal(new Set(p1.rows.concat(p2.rows).map((r) => r.id)).size, x.rows.length);
  const k = (await demoMod.client('owner', new Date('2026-11-23T03:00:00Z')).rpc('kpi_tab_v1', { p_property_id: PROP })).data; assert.equal(k.admin.kpi_ledger_from, '2026-11'); assert.equal(k.admin.kpi_source, 'ledger');
  assert.match(STY, /\.E_today \.E_tadd\.btn-primary \{ background: var\(--v5-gold\); border-color: var\(--v5-gold\); color: var\(--v5-gold-fg\)/); assert.match(CSS, /\.E_sticky \.btn-primary \{ background: var\(--v5-gold\)/);
});

test('fix 10-13: attach and save refusals read as plain words that match the receipt codes', async () => {
  const att = (status, code) => ({ error: { context: { status, json: () => Promise.resolve({ ok: false, error: code }) } } });
  for (const [status, code, re] of [[413, 'too_large', /That file is over 5 MB\./], [415, 'unsupported_type', /Use a photo or a PDF\./], [400, 'unsupported_image_type', /Use a photo or a PDF\./], [400, 'unsupported_type', /Use a photo or a PDF\./]]) {
    const b = await boot({ sub: 'add', shrinkImage: SHRINK, fn: { attach: () => att(status, code) } }); await b.pick(JPG); assert.match(b.text(), re, status + ' ' + code);
  }
  const { E } = loadModule(), L = E.lib;
  for (const c of ['bad_path', 'no_file', 'no_upload_record']) { assert.equal(L.receiptWords({ ok: false, error: c }), 'Attach the receipt again.', c); assert.equal(L.saveWords({ ok: false, error: c }), 'Attach the receipt again.', c); }
  assert.equal(L.receiptWords({ error: 'receipt_in_use' }), 'This receipt is already in Inventory.'); assert.equal(L.saveWords({ error: 'receipt_in_use' }), 'This receipt is already in Inventory.');
  assert.equal(L.saveWords({ error: 'future_date' }), 'The date can’t be later than tomorrow.'); assert.match(L.saveWords({ error: 'amount_locked' }), /Inventory/); assert.doesNotMatch(L.receiptWords({ error: 'bad_path' }), /connection/);
  const b = await boot({ sub: 'add', shrinkImage: SHRINK, fn: { attach: () => ATTACH() }, rpc: { admin_save_transaction_v2: () => ({ ok: false, error: 'no_upload_record' }) } });
  await b.pick(JPG); await b.click('review-add'); await b.click('save'); assert.match(b.text(), /Attach the receipt again\./); assert.match(b.html(), /Review and save/, 'back on the form');
  const c = await boot({ shrinkImage: SHRINK, fn: { attach: () => ATTACH(), sign: () => ({ ok: true, links: {} }) }, rpc: { expense_receipt_set_v1: () => ({ ok: false, error: 'no_file' }) } }); await c.click('open', 'r1'); await c.pick(JPG); assert.match(c.text(), /Attach the receipt again\./);
});

test('fix 11: a confirmed row that looks like another gets a grey line, never the review colour', async () => {
  const b = await boot({ screen: SCREEN({ rows: [ROW({ id: 'c1', lookalike_id: 'r3' }), ROW({ id: 'r3', chip: 'stock', date: '2026-11-21', amount: '540.00', stock: { lines: 1, items: 1 }, amount_locked: true }), ROW({ id: 'p1', status: 'pending_review', chip: 'telegram', lookalike_id: 'r3' })] }) });
  assert.match(b.html(), /<span class="E_sub E_lookm">Looks like Stock 21 Nov \(₱540\.00\)<\/span>/); assert.equal((b.html().match(/class="E_look"/g) || []).length, 1, 'the review colour class only on the Needs review row');
  await b.click('open', 'c1'); assert.match(b.html(), /<p class="E_sub E_lookm">Looks like Stock 21 Nov/); assert.doesNotMatch(b.html().slice(b.html().indexOf('E_sheet')), /class="E_look"/);
  assert.match(CSS, /\.E_lookm \{ color: var\(--v5-ink-2\)/); assert.doesNotMatch(CSS.match(/\.E_lookm[^}]*\}/)[0], /warn/);
});

test('fix 14: Show more sends the last row id with its created_at, so rows that share a time are neither skipped nor repeated', async () => {
  const T = '2026-11-22T02:00:00Z', all = [ROW({ id: 'a3', created_at: T }), ROW({ id: 'a2', created_at: T }), ROW({ id: 'a1', created_at: T })];
  const page = (args) => { const rows = args.p_before ? all.filter((r) => r.created_at < args.p_before || (r.created_at === args.p_before && r.id < args.p_before_id)) : all; return SCREEN({ rows: rows.slice(0, 2), more: rows.length > 2 }); };
  const b = await boot({ rpc: { expenses_screen_v1: page } }); assert.equal((b.html().match(/data-e="open"/g) || []).length, 2); assert.match(b.html(), /data-e="more"/);
  await b.click('more'); const c = b.sent('expenses_screen_v1').at(-1)[1]; assert.equal(c.p_before, T); assert.equal(c.p_before_id, 'a2');
  assert.deepEqual([...b.html().matchAll(/data-e="open" data-id="(\w+)"/g)].map((m) => m[1]), ['a3', 'a2', 'a1'], 'the tied third row arrives once');
  assert.doesNotMatch(b.html(), /data-e="more"/);
});

test('fix 15: stock purchases not yet in the expenses are said once, in grey', async () => {
  let b = await boot({ screen: SCREEN({ unlinked: 3 }) }); assert.match(b.html(), /<p class="E_sub E_unl">3 stock purchases are not in the expenses yet\.<\/p>/); assert.doesNotMatch(b.html().match(/<p class="E_sub E_unl">[^]*?<\/p>/)[0], /warn/);
  b = await boot({ screen: SCREEN({ unlinked: 1 }) }); assert.match(b.text(), /1 stock purchase is not in the expenses yet\./);
  b = await boot({ screen: SCREEN({ unlinked: 0 }) }); assert.doesNotMatch(b.html(), /E_unl/); assert.match(CSS, /\.E_unl \{ color: var\(--v5-ink-2\)/);
});

test('fix 16: the Today card counts reviews from every month and opens the needs-review filter', async () => {
  const card = APP.slice(APP.indexOf('function A_expCard'), APP.indexOf('function A_loadExpenses')), fnc = new Function('state', 'role', 'esc', 'A_peso', 'ICON', card + '; return A_expCard;');
  const mk = (e) => fnc({ expenses: e, layout: 'admin' }, () => 'owner', (s) => String(s), (x) => '₱' + Number(x).toLocaleString('en-PH'), () => '+')();
  const base = { month: '2026-11-01', total: 100, basis: 0, pending: { count: 2, total: 5 }, can_write: true };
  assert.match(mk({ ...base, pending_all: { count: 7, total: 90 } }), /<a class="E_trev" href="#expenses\/review">7 to review<\/a>/, 'pending_all wins');
  assert.match(mk(base), />2 to review</, 'no pending_all: this month only');
  assert.doesNotMatch(mk({ ...base, pending_all: { count: 0, total: 0 } }), /to review/, 'present and zero: nothing waits anywhere');
  const b = await boot({ sub: 'review' }); assert.equal(b.sent('expenses_screen_v1')[0][1].p_filter, 'review'); assert.match(b.html(), /data-id="all"[^>]*>Needs review ×/);
  await b.click('chip', 'all'); assert.equal(b.sent('expenses_screen_v1').at(-1)[1].p_filter, null);
  assert.match(STY, /\.E_today \.E_trev \{ display: inline-block; padding: 15px 0; margin: -15px 0;/, 'the tap target reaches 44 px without making the card taller');
  assert.match(STY, /\.E_today \.E_tsub \{ display: block; letter-spacing: -\.01em;/, 'the sub line stays on one line (mockup A)');
});

test('round 2: stock row edit is date/payee read-only; review line for earlier months; no dead receipt check', async () => {
  const STK = ROW({ id: 'k1', chip: 'stock', amount_locked: true, locked: false, stock: { lines: 1, items: 1 } });
  const b = await boot({ screen: SCREEN({ rows: [STK] }) }); await b.click('open', 'k1'); await b.click('edit');
  assert.match(b.html(), /id="E_date"[^>]*disabled/); assert.match(b.html(), /id="E_payee"[^>]*disabled/); assert.match(b.html(), /Change the price in Inventory/);
  await b.type('date', '2099-01-01'); await b.type('payee', 'Someone Else'); // the inputs are disabled; even forced values must never reach the server
  await b.type('notes', 'New note'); await b.type('reason', 'fix words'); await b.click('edit-save');
  const sent = b.sent('admin_save_transaction_v2'); assert.equal(sent.length, 1); assert.deepEqual(Object.keys(sent[0][1].p_txn).sort(), ['id', 'notes', 'reason']);
  assert.ok(!('transaction_date' in sent[0][1].p_txn) && !('payee_name' in sent[0][1].p_txn), 'stock row: no date or payee sent');
  const more = await boot({ sub: 'review', screen: SCREEN({ pending_all: { count: 5, total: 100 } }) });
  assert.match(more.text(), /3 more waiting in earlier months\./); assert.doesNotMatch(more.html(), /E_warn[^"]*"[^>]*>3 more/);
  const none = await boot({ sub: 'review', screen: SCREEN({ pending_all: { count: 2, total: 100 } }) }); assert.doesNotMatch(none.text(), /more waiting in earlier/);
  const all = await boot({ screen: SCREEN({ pending_all: { count: 5, total: 100 } }) }); assert.doesNotMatch(all.text(), /more waiting in earlier/, 'only on the review filter');
  assert.doesNotMatch(read('expenses/E_expenses.js'), /r\.ocr_confidence/);
});

test('round 3: a staff pay row edit never sends category (Pay staff owns it); a stock row with a late date still saves', async () => {
  const S1 = ROW({ id: 's1', chip: 'staff_pay', locked: true, amount_locked: true, category: 'cleaning', receipt_can: { add: false, replace: false, remove: false } });
  const b = await boot({ screen: SCREEN({ rows: [S1] }) }); await b.click('open', 's1'); await b.click('edit');
  assert.match(b.html(), /<div class="E_input E_ro" id="E_cat">/, 'category is read-only'); assert.doesNotMatch(b.html(), /<select[^>]*id="E_cat"/);
  await b.type('category', 'supplies'); await b.type('notes', 'Changed words'); await b.type('reason', 'fix words'); await b.click('edit-save');
  const sent = b.sent('admin_save_transaction_v2'); assert.equal(sent.length, 1); assert.deepEqual(Object.keys(sent[0][1].p_txn).sort(), ['id', 'notes', 'reason']);
  const STK = ROW({ id: 'k1', chip: 'stock', amount_locked: true, locked: false, date: '2099-12-31', stock: { lines: 1, items: 1 } });
  const c = await boot({ screen: SCREEN({ rows: [STK] }) }); await c.click('open', 'k1'); await c.click('edit');
  await c.type('notes', 'Later date row'); await c.type('reason', 'fix words'); await c.click('edit-save');
  const s2 = c.sent('admin_save_transaction_v2'); assert.equal(s2.length, 1, 'no date validation on a stock row'); assert.deepEqual(Object.keys(s2[0][1].p_txn).sort(), ['id', 'notes', 'reason']);
});
test('round 4: a guest refund row keeps guest_refund (read-only) and a notes-only edit saves; Today sub line never wraps', async () => {
  const RF = ROW({ id: 'rf1', chip: 'refund', locked: true, amount_locked: true, category: 'guest_refund', receipt_can: { add: false, replace: false, remove: false } });
  const b = await boot({ screen: SCREEN({ rows: [RF] }) }); await b.click('open', 'rf1'); await b.click('edit');
  assert.match(b.html(), /<div class="E_input E_ro" id="E_cat">/, 'refund category is read-only'); assert.doesNotMatch(b.html(), /<select[^>]*id="E_cat"/);
  await b.type('notes', 'Refund note'); await b.type('reason', 'fix words'); await b.click('edit-save');
  const sent = b.sent('admin_save_transaction_v2'); assert.equal(sent.length, 1, 'notes-only edit is not blocked'); assert.deepEqual(Object.keys(sent[0][1].p_txn).sort(), ['id', 'notes', 'reason']);
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  assert.match(css, /\.E_today \.E_tsub \{[^}]*white-space: nowrap; overflow: hidden; text-overflow: ellipsis;/);
});
