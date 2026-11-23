// s134 L2b: the Manage "Waiting for your review" queue and the one shared set of words with the Expenses screen.
// Frozen clock; the module runs in a vm sandbox with a tiny fake DOM and a fake Supabase client that records every call.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(process.env.N_MODULE || path.join(root, 'manage', 'N_manage.js'), 'utf8'); // a red-on-old-code run points this at a reverted copy
const ESRC = fs.readFileSync(process.env.E_MODULE || path.join(root, 'expenses', 'E_expenses.js'), 'utf8');
const NOW = Date.parse('2026-10-14T03:00:00Z');
const tick = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const plain = (x) => JSON.parse(JSON.stringify(x));
class FakeEl {
  constructor() { this.html = ''; this.l = {}; }
  set innerHTML(v) { this.html = String(v); }
  get innerHTML() { return this.html; }
  addEventListener(t, f) { (this.l[t] ||= []).push(f); }
  removeEventListener(t, f) { this.l[t] = (this.l[t] || []).filter((x) => x !== f); }
  querySelector() { return null; }
}
function fakeClient(handlers) {
  const calls = [];
  return {
    calls,
    from() { const ch = new Proxy({}, { get: (_, k) => (k === 'then' ? (res) => Promise.resolve({ data: [], error: null }).then(res) : () => ch) }); return ch; },
    rpc(name, args) {
      calls.push([name, plain(args || {})]); const h = handlers[name];
      if (!h) return Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.' + name } });
      return Promise.resolve({ data: plain(h(args)), error: null });
    }
  };
}
const CATS = [{ slug: 'cleaning', label: 'Cleaning', sort_order: 1 }, { slug: 'supplies', label: 'Supplies', sort_order: 3 }];
const RQ = (id, o = {}) => ({ id, transaction_date: '2026-10-12', txn_type: 'expense', category: 'supplies', gross_amount: '120.00', payee_name: 'Market', notes: 'Fruit', or_number: null, source: 'manual', receipt_image_path: null, ocr_confidence: null, created_at: '2026-10-12T02:00:00Z', ...o });
const sandbox = (win) => ({ window: win, localStorage: undefined, navigator: { onLine: true }, MutationObserver: undefined, Intl, Date, Promise, JSON, Math, console, setTimeout, clearTimeout, Uint8Array,
  document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} }, history: { replaceState() {} } });
async function boot(rows, tx) {
  const win = {}, ctx = sandbox(win);
  vm.createContext(ctx); vm.runInContext(SRC, ctx, { filename: 'N_manage.js' }); win.N_Manage._setClock(() => NOW);
  const c = fakeClient({ expense_categories_v1: () => CATS, admin_review_queue_v1: () => ({ count: rows.length, total: '1', rows, truncated: false }), admin_review_transaction_v1: tx || (() => ({ ok: true })) });
  const el = new FakeEl(), toasts = [];
  win.N_Manage.mount(el, { client: c, demo: false, role: 'owner', sub: 'money', navigate() {}, toast: (m) => toasts.push(m), haptic() {}, newKey: (p) => p + '-0000000000000001' });
  await tick();
  const target = (attrs) => { const t = { getAttribute: (k) => (k in attrs ? attrs[k] : null) }; t.closest = (sel) => { const m = /^\[([\w-]+)\]$/.exec(sel); return m && m[1] in attrs ? t : null; }; return t; };
  const fire = async (type, ev) => { for (const f of el.l[type] || []) f(ev); await tick(); };
  return {
    M: win.N_Manage, c, el, toasts, html: () => el.innerHTML, text: () => el.innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '),
    click: (act, v) => fire('click', { target: target({ 'data-n': act, ...(v !== undefined ? { 'data-v': v } : {}) }), preventDefault() {} }),
    sent: () => c.calls.filter((x) => x[0] === 'admin_review_transaction_v1')
  };
}
function loadE() {
  const win = { ICON: (n) => `<i data-ic="${n}"></i>` };
  const ctx = { window: win, navigator: { onLine: true }, Intl, Date, Promise, JSON, Math, console, setTimeout, clearTimeout, Uint8Array, atob, URL: { createObjectURL: () => 'blob:t', revokeObjectURL() {} }, Blob: class {} };
  vm.createContext(ctx); vm.runInContext(ESRC, ctx, { filename: 'E_expenses.js' }); return win.E_Expenses;
}
const INC = 'Amount incomplete - price the rest in Inventory';
const approveBtn = (h) => /<button[^>]*data-n="rq-approve"[^>]*>/.exec(h)[0];

test('L2b queue row: an incomplete stock row shows the warm cue in the list, a normal row does not', async () => {
  const t = await boot([RQ('r1', { s134_incomplete: true, source: 'stock' }), RQ('r2')]);
  assert.match(t.text(), new RegExp(INC)); assert.equal((t.html().match(/Amount incomplete/g) || []).length, 1, 'only the incomplete row carries it');
  assert.match(t.html(), /class="N_rows E_inc N_inc">Amount incomplete/);
  const css = fs.readFileSync(path.join(root, 'manage', 'N_manage.css'), 'utf8'); assert.match(css, /\.N_inc\s*\{[^}]*var\(--v5-warn-glass\)/);
  const f = await boot([RQ('r2', { s134_incomplete: false })]); assert.ok(!/Amount incomplete/.test(f.text()));
  const s = await boot([RQ('r3', { s134_incomplete: 'true' })]); assert.ok(!/Amount incomplete/.test(s.text()), 'only boolean true counts');
});
test('L2b review sheet: Approve is disabled and sends nothing for an incomplete row; Void stays available', async () => {
  const t = await boot([RQ('r1', { s134_incomplete: true, source: 'stock' })]);
  await t.click('rq-open', 'r1'); assert.match(t.text(), /Review a transaction/); assert.match(t.html(), /role="status">Amount incomplete/);
  assert.match(approveBtn(t.html()), /\sdisabled/); await t.click('rq-approve'); assert.equal(t.sent().length, 0, 'a forced tap still sends nothing'); assert.match(t.text(), new RegExp(INC));
  assert.ok(!/data-n="rq-void-start"[^>]*disabled/.test(t.html()), 'void is open');
  await t.click('rq-void-start'); assert.match(t.text(), /Why is it being voided/);
  const ok = await boot([RQ('r2')]); await ok.click('rq-open', 'r2'); assert.ok(!/\sdisabled/.test(approveBtn(ok.html())), 'a complete row can be approved');
});
for (const [name, res, words] of [
  ['amount_incomplete', { ok: false, error: 'amount_incomplete', where: 'Inventory' }, INC],
  ['amount_locked', { ok: false, error: 'amount_locked', where: 'Inventory' }, 'That amount follows Inventory. Change the price in Inventory.'],
  ['system_category', { ok: false, error: 'system_category' }, 'This category is set by the system and can’t be picked here.'],
  ['locked by Pay staff', { ok: false, error: 'locked', where: 'Pay staff' }, 'This category is set by Pay staff.'],
  ['locked elsewhere', { ok: false, error: 'locked', where: 'Inventory' }, 'This entry is locked. Only the category and notes can change here.']
]) {
  test(`L2b refusal ${name}: the sheet says the words, keeps the row, sends once`, async () => {
    const t = await boot([RQ('r1')], () => res);
    await t.click('rq-open', 'r1'); await t.click('rq-approve'); assert.equal(t.sent().length, 1);
    assert.ok(t.text().includes(words), 'sheet shows: ' + words); assert.ok(!/Nothing was changed/.test(t.text()));
    assert.match(t.text(), /Waiting for your review \(1\)/, 'the row stays listed'); assert.equal(t.toasts.length, 0);
    assert.equal(t.M.lib.refusalWords(res), words);
  });
}
test('L2b refusal: an unknown refusal keeps the plain fallback', async () => {
  const t = await boot([RQ('r1')], () => ({ ok: false, error: 'something_new' }));
  await t.click('rq-open', 'r1'); await t.click('rq-approve'); assert.match(t.text(), /Nothing was changed\. Please check it and try again\./);
});
test('L2b saveWords: system_category, and locked depends on where', () => {
  const L = loadE().lib;
  assert.equal(L.saveWords({ error: 'system_category' }), 'This category is set by the system and can’t be picked here.');
  assert.equal(L.saveWords({ error: 'locked', where: 'Pay staff' }), 'This category is set by Pay staff.');
  assert.equal(L.saveWords({ error: 'locked' }), 'This entry is locked. Only the category and notes can change here.');
  assert.equal(L.saveWords({ error: 'locked', where: 'Inventory' }), 'This entry is locked. Only the category and notes can change here.');
});
test('L2b: Manage and Expenses say the same words for the lines they share', async () => {
  const L = loadE().lib, t = await boot([]), W = (r) => t.M.lib.refusalWords(r);
  for (const r of [{ error: 'amount_incomplete', where: 'Inventory' }, { error: 'system_category' }, { error: 'locked', where: 'Pay staff' }, { error: 'amount_locked', where: 'Inventory' }, { error: 'locked', where: 'Inventory' }, { error: 'locked' }]) assert.equal(W(r), L.saveWords(r), r.error);
  assert.equal(t.M.lib.INCOMPLETE, INC); assert.match(ESRC, /incomplete: 'Amount incomplete - price the rest in Inventory'/);
});
test('L2b demo: the queue fixture holds one incomplete pending stock row', async () => {
  const win = {}, ctx = sandbox(win); vm.createContext(ctx); vm.runInContext(SRC, ctx); win.N_Manage._setClock(() => NOW);
  const el = new FakeEl(); win.N_Manage.mount(el, { demo: true, role: 'owner', sub: 'money', navigate() {}, toast() {}, haptic() {} }); await tick();
  assert.match(el.innerHTML.replace(/<[^>]+>/g, ' '), /Demo shop[\s\S]*Amount incomplete - price the rest in Inventory/); assert.equal((el.innerHTML.match(/Amount incomplete/g) || []).length, 1);
});
test('L2b: a server amount_incomplete refusal on a stale row shows the cue and disables Approve', async () => {
  const t = await boot([RQ('r1')], () => ({ ok: false, error: 'amount_incomplete', where: 'Inventory' }));
  await t.click('rq-open', 'r1'); assert.ok(!/\sdisabled/.test(approveBtn(t.html())));
  await t.click('rq-approve'); assert.equal(t.sent().length, 1);
  assert.match(approveBtn(t.html()), /\sdisabled/, 'Approve disabled after the refusal'); assert.match(t.html(), /role="status">Amount incomplete/);
  await t.click('rq-approve'); assert.equal(t.sent().length, 1, 'no second send');
});
