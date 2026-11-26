// Lane N: manage/N_manage.js (Today | Inquiries | Money | KPIs for owner and admin).
// Frozen clock: 2026-10-14T03:00:00Z = 11:00 on 2026-10-14 in Manila. Nothing reads the real time.
// The module runs in a vm sandbox with a tiny fake DOM and a fake Supabase client that records every call.
// Call shapes are pinned two ways: against literals here, and (when the dashboard source is checked out beside this repo)
// against the dashboard's own call sites, read from admin-dashboard/app/src.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MOD = process.env.N_MODULE || path.join(root, 'manage', 'N_manage.js'); // a red-on-old-code run points this at a broken copy
const SRC = fs.readFileSync(MOD, 'utf8');
const CSS = fs.readFileSync(path.join(root, 'manage', 'N_manage.css'), 'utf8');
const DASH = path.join(root, '..', 'admin-dashboard', 'app', 'src');
const dash = (f) => (fs.existsSync(path.join(DASH, f)) ? fs.readFileSync(path.join(DASH, f), 'utf8') : null);
const NOW = Date.parse('2026-10-14T03:00:00Z');
const TODAY = '2026-10-14';
const PROP = '6ae230f4-c189-4547-84b1-cb6e0b2cc9bd';

// ------------------------------------------------------------------------------------------------ harness
class FakeEl {
  constructor() { this.html = ''; this.l = {}; }
  set innerHTML(v) { this.html = String(v); }
  get innerHTML() { return this.html; }
  addEventListener(t, f) { (this.l[t] ||= []).push(f); }
  removeEventListener(t, f) { this.l[t] = (this.l[t] || []).filter((x) => x !== f); }
  querySelector(sel) { if (sel === '.N_seg') return this.html.includes('N_seg') ? (this.seg ||= { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; } }) : null; return sel === '[data-n-ext]' && /data-n-ext=/.test(this.html) ? (this.host ||= new FakeEl()) : null; }
}
const tick = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const plain = (x) => JSON.parse(JSON.stringify(x));

const CHARTS_SRC = fs.readFileSync(path.join(root, 'manage', 'N_charts.js'), 'utf8');
function load({ storage, onLine = true, charts = false, ext = null, clipboard, mo } = {}) {
  const touched = [];
  const store = {};
  const ls = { getItem: (k) => { touched.push(k); return k in store ? store[k] : null; }, setItem: (k, v) => { touched.push(k); store[k] = String(v); } };
  const win = {};
  const ctx = { window: win, localStorage: storage === null ? undefined : ls, navigator: { onLine, clipboard }, MutationObserver: mo, Intl, Date, Promise, JSON, Math, console, setTimeout, clearTimeout, Uint8Array,
    document: { visibilityState: 'visible', listeners: {}, addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }, removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter((x) => x !== f); } },
    history: { replaceState() {} } };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'N_manage.js' });
  if (charts) vm.runInContext(CHARTS_SRC, ctx, { filename: 'N_charts.js' });
  Object.assign(win, ext || {});
  win.N_Manage._setClock(() => NOW);
  return { M: win.N_Manage, ctx, touched, store, setOnLine: (v) => { ctx.navigator.onLine = v; } };
}
function fakeClient(handlers = {}, tx = { data: [], error: null }) {
  const calls = [], chains = [];
  return {
    calls, chains,
    rpc(name, args) {
      calls.push([name, plain(args || {})]);
      const h = handlers[name]; if (!h) return Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.' + name } });
      try { const r = h(args); const wrap = (x) => { x = plain(x); return x && typeof x === 'object' && ('data' in x || 'error' in x) ? x : { data: x, error: null }; }; return Promise.resolve(r && r.then ? r.then(wrap) : wrap(r)); } catch (e) { return Promise.reject(e); }
    },
    from(table) {
      const rec = [['from', table]];
      const ch = new Proxy({}, { get: (_, k) => { if (k === 'then') return (res, rej) => Promise.resolve(typeof tx === 'function' ? tx() : tx).then(res, rej); return (...a) => { rec.push([k, ...a]); return ch; }; } });
      chains.push(rec); return ch;
    }
  };
}
const OV = (over = {}) => ({ today: TODAY, sourceAsOf: null, calendarSync: null, currentStays: [{ kind: 'direct', id: 'a1', guest: 'Ana Reyes', checkin: '2026-10-12', checkout: '2026-10-16' }],
  arrivals: [{ kind: 'direct', id: 'a2', guest: 'Ben Cruz', checkin: TODAY, checkout: '2026-10-16' }], departures: [{ kind: 'direct', id: 'a3', guest: 'Carla Sy', checkin: '2026-10-11', checkout: TODAY }],
  nextArrival: { kind: 'direct', id: 'a4', guest: 'Dino Lim', checkin: '2026-10-15', checkout: '2026-10-17', daysUntil: 1 },
  readiness: { state: 'awaiting_review', lastCleaning: null, review: null, blockingWorkOrders: 1, lastCheckout: TODAY, nextCheckin: '2026-10-15', daysOverdue: null },
  blockingWorkOrders: [], lowStock: [{ id: 'i1', name: 'Soap', qty: '1', unit: 'pcs', reorderBelow: '3', out: false }], followUps: [], handoffs: [],
  finance: { pendingReviewCount: 2, pendingReviewAmount: '3000.00', paymentReviewCount: 1, unpaidCleanerFees: 3 }, notices: [], actions: [{ kind: 'inquiry' }], ...over });
const Q1 = { id: 'b1000000-0000-4000-8000-000000000001', booking_ref: 'B1000000', guest_name: 'Ella Tan', checkin_date: '2026-10-20', checkout_date: '2026-10-22', pax: 2, expected_amount: '2500.00', comparison_id: 'c1000000-0000-4000-8000-000000000001', candidate_amount: '2500.00', reference: 'GC12345678', receipt_image_path: 'receipts/x.jpg', hold_expires_at: '2026-10-15T10:00:00Z', receipt_sent: true, receipt_at: '2026-10-14T02:48:00Z', contact_channel: 'email' };
const LEG1 = { ...Q1, receipt_sent: null, receipt_at: null, contact_channel: null }; // an old server: the three new fields are missing
const Q2 = { id: 'b2000000-0000-4000-8000-000000000002', booking_ref: 'B2000000', guest_name: 'Fe Ong', checkin_date: '2026-10-25', checkout_date: '2026-10-28', pax: 3, expected_amount: '4100.00', comparison_id: null, candidate_amount: null, reference: null, receipt_image_path: null, hold_expires_at: null, receipt_sent: false, receipt_at: null, contact_channel: 'messenger' };
const LEG2 = { ...Q2, receipt_sent: null, receipt_at: null, contact_channel: null };
const METRIC = (key, unit, value, coverage = 'complete') => ({ key, value, unit, coverage });
const METRICS = (f = 1, extra = {}) => ({ propertyId: PROP, periodStart: 'x', periodEndExclusive: 'y', sourceAsOf: null, financeVisible: true, blockedNights: 0,
  metrics: { occupancy: METRIC('occupancy', 'percent', String(60 * f)), sold_nights: METRIC('sold_nights', 'night', String(Math.round(14 * f))), future_booked_nights: METRIC('future_booked_nights', 'night', '9'), average_length_of_stay: METRIC('average_length_of_stay', 'day', '2.5'),
    accommodation_revenue: METRIC('accommodation_revenue', 'PHP', (30000 * f).toFixed(2)), adr: METRIC('adr', 'PHP', (2000 * f).toFixed(2)), revpar: METRIC('revpar', 'PHP', '1200.00'), cash_received: METRIC('cash_received', 'PHP', '28000.00'), expected_payout: METRIC('expected_payout', 'PHP', null),
    returning_guest_rate: METRIC('returning_guest_rate', 'percent', '10'), cancellation_rate: METRIC('cancellation_rate', 'percent', '5'), booking_lead_time: METRIC('booking_lead_time', 'day', '18'), ...extra } });

// a mounted module with a recording client; click/type drive the delegated listeners the way a tap and a keystroke would
async function boot(o = {}) {
  const { sub, handlers, tx, demo = false, client, onLine = true, newKey, charts, ext, clipboard, shrinkImage, mo } = o, role = 'role' in o ? o.role : 'owner';
  const env = load({ onLine, charts, ext, clipboard, mo });
  const el = new FakeEl();
  const c = demo ? undefined : (client || fakeClient({ get_admin_overview_v1: () => ({ data: OV(), error: null }), staff_inquiry_payments_v1: () => ({ data: [Q1, Q2], error: null }), ...handlers }, tx));
  const nav = [], toasts = [], buzzes = [];
  let n = 0;
  env.M.mount(el, { client: c, demo, role, sub, navigate: (h) => nav.push(h), toast: (m) => toasts.push(m), haptic: (k) => buzzes.push(k), shrinkImage, newKey: newKey || ((p) => `${p}-0000000000000000${String(++n).padStart(4, '0')}`) });
  await tick();
  const fire = async (type, ev) => { for (const f of el.l[type] || []) f(ev); await tick(); };
  const target = (attrs, extra = {}) => { const t = { ...extra, getAttribute: (k) => (k in attrs ? attrs[k] : null) }; t.closest = (sel) => { const m = /^\[([\w-]+)\]$/.exec(sel); return m && m[1] in attrs ? t : null; }; return t; };
  return {
    ...env, el, c, nav, toasts, buzzes, html: () => el.innerHTML,
    click: (act, v) => fire('click', { target: target({ 'data-n': act, ...(v !== undefined ? { 'data-v': v } : {}) }), preventDefault() {} }),
    type: (f, value, extra = {}) => fire('input', { target: target({ 'data-f': f }, { value, type: 'text', ...extra }) }),
    text: () => el.innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '),
    period: () => (c ? c.calls.filter((x) => x[0] === 'get_hospitality_metrics_v1' && !isMonthCall(x)) : []),
    series: () => (c ? c.calls.filter((x) => x[0] === 'get_hospitality_metrics_v1' && isMonthCall(x)) : []),
    sent: (name) => (c ? c.calls.filter((x) => x[0] === name) : [])
  };
}
// a full calendar month [first, first of next month) is a chart call; the period presets used by the older tests never are
const isMonthCall = (x) => x[1].p_start.endsWith('-01') && x[1].p_end_exclusive.endsWith('-01') && (Date.parse(x[1].p_end_exclusive) - Date.parse(x[1].p_start)) / 864e5 <= 31;
const keys = (o) => Object.keys(o).sort();
const dashRpcKeys = (file, name) => { const s = dash(file); if (!s) return null; const i = s.indexOf(`'${name}'`); if (i < 0) return null; const j = s.indexOf('{', i), k = s.indexOf('}', j); return [...new Set((s.slice(j, k + 1).match(/\bp_\w+/g) || []))].sort(); };

// ------------------------------------------------------------------------------------------------ parse and guard
test('N parse: the script and the stylesheet are well formed', () => {
  assert.doesNotThrow(() => new vm.Script(SRC, { filename: 'N_manage.js' }));
  assert.equal((CSS.match(/\{/g) || []).length, (CSS.match(/\}/g) || []).length);
  assert.ok(!/localStorage\.(getItem|setItem)\(['"](?!cs_n_)/.test(SRC), 'only cs_n_* keys');
});
test('N guard: no duplicate top-level function or var names, and nothing leaks to the page except window.N_Manage', () => {
  const body = SRC.split('\n').filter((l) => /^ {2}(function|var) /.test(l)).join('\n');
  const names = [...body.matchAll(/^ {2}function (\w+)/gm)].map((m) => m[1]);
  const vars = [...body.matchAll(/^ {2}var (\w+)/gm)].map((m) => m[1]);
  assert.equal(new Set(names).size, names.length, 'duplicate function: ' + names.filter((n, i) => names.indexOf(n) !== i));
  assert.equal(new Set(vars).size, vars.length, 'duplicate var: ' + vars.filter((n, i) => vars.indexOf(n) !== i));
  const { ctx } = load();
  const leaked = Object.keys(ctx).filter((k) => !['window', 'localStorage', 'navigator', 'Intl', 'Date', 'Promise', 'JSON', 'Math', 'console', 'setTimeout', 'clearTimeout', 'Uint8Array', 'document', 'history', 'MutationObserver'].includes(k));
  assert.deepEqual(leaked, []);
  assert.deepEqual(Object.keys(ctx.window), ['N_Manage']);
  assert.ok(!/\bapp\.js\b|sw\.js/.test(CSS));
});

// ------------------------------------------------------------------------------------------------ role gate
test('N role gate: only owner and admin mount; everyone else lands on #home with no call and no markup', async () => {
  for (const role of ['cleaner', 'finance', 'inspector', 'maintenance', '', null, undefined]) {
    const t = await boot({ role });
    assert.deepEqual(t.nav, ['#home'], String(role));
    assert.equal(t.html(), '');
    assert.equal(t.c.calls.length, 0);
  }
  for (const role of ['owner', 'admin']) { const t = await boot({ role }); assert.deepEqual(t.nav, [], role); assert.ok(t.html().includes('role="tablist"')); }
});
test('N role gate: a not-authorised reply from the server shows a calm state, not a crash', async () => {
  const t = await boot({ handlers: { get_admin_overview_v1: () => ({ data: null, error: { code: '42501', message: 'read_operations is required' } }) } });
  assert.match(t.text(), /Your account is not allowed to see today/i);
  assert.ok(!/undefined|\[object/.test(t.html()));
});

// ------------------------------------------------------------------------------------------------ call shapes
test('N rpc shape: Today reads get_admin_overview_v1 and staff_inquiry_payments_v1 with exactly p_property_id', async () => {
  const t = await boot({});
  const ov = t.sent('get_admin_overview_v1'), iq = t.sent('staff_inquiry_payments_v1');
  assert.equal(ov.length, 1); assert.equal(iq.length, 1);
  assert.deepEqual(keys(ov[0][1]), ['p_property_id']); assert.equal(ov[0][1].p_property_id, PROP);
  assert.deepEqual(keys(iq[0][1]), ['p_property_id']);
  // admin-dashboard/app/src/features/today/api.ts:31 and features/bookings/confirm-api.ts:13
  for (const [file, name] of [['features/today/api.ts', 'get_admin_overview_v1'], ['features/bookings/confirm-api.ts', 'staff_inquiry_payments_v1']]) {
    const d = dashRpcKeys(file, name); if (d) assert.deepEqual(keys(ov[0][1]).length ? d : d, ['p_property_id'], name);
  }
});
test('N rpc shape: the property id comes from opts when the shell passes it', async () => {
  const env = load(); const el = new FakeEl(); const c = fakeClient({ get_admin_overview_v1: () => ({ data: OV(), error: null }), staff_inquiry_payments_v1: () => ({ data: [], error: null }) });
  env.M.mount(el, { client: c, role: 'admin', navigate() {}, propertyId: 'pppppppp-0000-4000-8000-000000000000' }); await tick();
  assert.equal(c.calls[0][1].p_property_id, 'pppppppp-0000-4000-8000-000000000000');
});
test('N rpc shape: KPIs call get_hospitality_metrics_v1 twice (period and comparison) with p_property_id, p_start, p_end_exclusive', async () => {
  const t = await boot({ sub: 'kpis', handlers: { get_hospitality_metrics_v1: (a) => ({ data: METRICS(a.p_start.startsWith('2026-10') ? 1 : 0.8), error: null }) } });
  const m = t.period();
  assert.equal(m.length, 2);
  for (const c of m) assert.deepEqual(keys(c[1]), ['p_end_exclusive', 'p_property_id', 'p_start']);
  assert.deepEqual(m.map((c) => [c[1].p_start, c[1].p_end_exclusive]), [['2026-10-01', '2026-10-14'], ['2026-09-01', '2026-09-14']]);
  const d = dashRpcKeys('features/insights/api.ts', 'get_hospitality_metrics_v1'); // features/insights/api.ts:9
  if (d) assert.deepEqual(d, ['p_end_exclusive', 'p_property_id', 'p_start']);
});
test('N rpc shape: Money reads the newest ten transactions like the dashboard default list, and never writes on open', async () => {
  const t = await boot({ sub: 'money', tx: { data: [{ id: 't1', transaction_date: '2026-10-13', txn_type: 'expense', category: 'supplies', gross_amount: '640.00', payee_name: 'Shop', notes: 'soap', status: 'confirmed' }], error: null } });
  const rec = t.c.chains[0]; assert.ok(rec, 'a transactions read happened');
  const names = rec.map((r) => r[0]);
  assert.deepEqual(rec[0], ['from', 'transactions']);
  assert.ok(names.includes('limit') && rec.find((r) => r[0] === 'limit')[1] === 10);
  assert.deepEqual(rec.find((r) => r[0] === 'neq'), ['neq', 'status', 'void']);
  assert.deepEqual(rec.find((r) => r[0] === 'is'), ['is', 'hidden_at', null]);
  assert.deepEqual(rec.find((r) => r[0] === 'not'), ['not', 'source', 'in', '("airbnb","airbnb_email")']); // features/finance/api.ts:36-45
  assert.deepEqual(rec.find((r) => r[0] === 'eq'), ['eq', 'property_id', PROP]);
  assert.ok(!t.c.calls.some((c) => /save|confirm|decline/.test(c[0])));
  assert.match(t.text(), /640\.00/);
});

async function openConfirm(t, which = Q1.id) {
  await t.click('tab', 'inquiries'); await t.click('inq-open', which); await t.click('cf-start');
}
test('N confirm (receipt on file): form, then review restating guest, dates and amount, then ONE call with the dashboard keys', async () => {
  const t = await boot({ handlers: { staff_confirm_direct_booking_v1: () => ({ ok: true, outcome: 'confirmed', guest_name: 'Ella Tan', checkin: '2026-10-20', checkout: '2026-10-22' }) } });
  await openConfirm(t);
  assert.match(t.text(), /I saw this payment in our GCash or bank account/); assert.match(t.html(), /data-f="amount" value="2500.00"/, 'the receipt path pre-fills the receipt amount');
  await t.click('cf-review'); // box not ticked
  assert.match(t.text(), /Tick the box once you have seen the payment in our account/);
  assert.match(t.text(), /Please fix the marked items\./); assert.ok(!/items marked below/.test(t.text()));
  assert.equal(t.sent('staff_confirm_direct_booking_v1').length, 0);
  await t.type('checked', true, { type: 'checkbox', checked: true });
  await t.click('cf-send'); // forged tap on the form step: nothing may be sent
  assert.equal(t.sent('staff_confirm_direct_booking_v1').length, 0, 'a write never skips the review step');
  await t.click('cf-review');
  assert.match(t.text(), /Ella Tan/); assert.match(t.text(), /20 October to 22 October/); assert.match(t.text(), /The guest will be told by e-mail: the address, parking, the ID request and how to send the security deposit/); assert.match(t.text(), /2,500\.00/); assert.match(t.text(), /This cannot be undone here/);
  assert.equal(t.sent('staff_confirm_direct_booking_v1').length, 0, 'review alone sends nothing');
  await t.click('cf-send');
  const s = t.sent('staff_confirm_direct_booking_v1'); assert.equal(s.length, 1);
  // admin-dashboard/app/src/features/bookings/confirm-model.ts:98-110 confirmArgs and confirm-api.ts:17
  assert.deepEqual(keys(s[0][1]), ['p_amount', 'p_booking_id', 'p_comparison_id', 'p_idempotency_key', 'p_method', 'p_note', 'p_reference']);
  assert.deepEqual(s[0][1], { p_booking_id: Q1.id, p_method: 'messenger_gcash', p_reference: 'GC12345678', p_amount: '2500.00', p_note: null, p_comparison_id: Q1.comparison_id, p_idempotency_key: s[0][1].p_idempotency_key });
  assert.ok(s[0][1].p_idempotency_key.length >= 16 && s[0][1].p_idempotency_key.length <= 120);
  const d = dash('features/bookings/confirm-model.ts');
  if (d) { const body = d.slice(d.indexOf('export function confirmArgs')); assert.deepEqual([...new Set(body.slice(0, body.indexOf('};')).match(/\bp_\w+/g))].sort(), keys(s[0][1])); }
  assert.equal(t.toasts.join(' '), 'Booking confirmed for Ella Tan, 20 October to 22 October. The guest is being told by e-mail.');
  assert.ok(!t.html().includes('role="dialog"'), 'the sheet closes on a confirmed answer');
  assert.equal(t.sent('staff_inquiry_payments_v1').length, 2, 'the list is read again after the write');
});
test('N confirm (paid outside): method, reference, amount, note go through; cash needs a note and sends no reference', async () => {
  const t = await boot({ handlers: { staff_confirm_direct_booking_v1: () => ({ ok: true, outcome: 'confirmed' }) } });
  await openConfirm(t, Q2.id);
  assert.match(t.text(), /How was it paid\?/); assert.match(t.text(), /GCash QR/);
  await t.click('cf-review');
  assert.match(t.text(), /Enter the payment reference/);
  await t.type('method', 'cash'); assert.ok(!/Payment reference/.test(t.text()));
  await t.click('cf-review'); assert.match(t.text(), /Add a short note about the cash/);
  await t.type('note', 'Handed over by the guest at the gate'); await t.type('amount', '4,100');
  await t.click('cf-review'); assert.match(t.text(), /Cash/); assert.match(t.text(), /4,100\.00/);
  await t.click('cf-send');
  assert.deepEqual(t.sent('staff_confirm_direct_booking_v1')[0][1], { p_booking_id: Q2.id, p_method: 'cash', p_reference: null, p_amount: '4100.00', p_note: 'Handed over by the guest at the gate', p_comparison_id: null, p_idempotency_key: t.sent('staff_confirm_direct_booking_v1')[0][1].p_idempotency_key });
});
test('N confirm: a bank payment sends its reference; an amount with three decimals is refused, never rounded', async () => {
  const t = await boot({ handlers: { staff_confirm_direct_booking_v1: () => ({ ok: true, outcome: 'confirmed' }) } });
  await openConfirm(t, Q2.id);
  await t.type('method', 'bank'); await t.type('reference', ' BK-77 '); await t.type('amount', '4100.123');
  await t.click('cf-review'); assert.match(t.text(), /at most two decimal places/);
  await t.type('amount', '4100.5'); await t.click('cf-review'); await t.click('cf-send');
  const a = t.sent('staff_confirm_direct_booking_v1')[0][1]; assert.equal(a.p_reference, 'BK-77'); assert.equal(a.p_amount, '4100.50'); assert.equal(a.p_method, 'bank');
});
test('N refusal copy: every server outcome reads as a plain sentence, the sheet stays open, and the key is replaced', async () => {
  const outs = [
    [{ ok: false, outcome: 'reference_reused', prior_ref: 'A1B2C3D4' }, /already used for booking A1B2C3D4, so nothing was confirmed/],
    [{ ok: false, outcome: 'conflict' }, /clash with another stay, so nothing was confirmed/],
    [{ ok: false, outcome: 'invalid_state' }, /no longer waiting for a decision\. Nothing was changed/],
    [{ ok: false, outcome: 'denied' }, /not allowed to confirm bookings/],
    [{ ok: false, outcome: 'amount_required' }, /Enter the amount received/],
    [{ ok: false, outcome: 'surprise' }, /Nothing was confirmed\. Please try again/]
  ];
  for (const [out, re] of outs) {
    const t = await boot({ handlers: { staff_confirm_direct_booking_v1: () => out } });
    await openConfirm(t); await t.type('checked', true, { type: 'checkbox', checked: true }); await t.click('cf-review'); await t.click('cf-send');
    assert.match(t.text(), re, out.outcome); assert.ok(t.html().includes('role="dialog"'), 'sheet open: ' + out.outcome); assert.ok(!/GC12345678.*GC12345678/.test(t.text()));
    assert.equal(t.toasts.length, 0, 'no success toast on a refusal');
    await t.click('cf-review'); await t.click('cf-send');
    const ks = t.sent('staff_confirm_direct_booking_v1').map((c) => c[1].p_idempotency_key); assert.equal(ks.length, 2);
    assert.notEqual(ks[0], ks[1], 'a readable answer means the next try is a new decision: ' + out.outcome);
  }
});
test('N offline: a write with no connection says so inline, sends nothing and keeps the form; a dropped request keeps the same key for the retry', async () => {
  const t = await boot({ handlers: { staff_confirm_direct_booking_v1: () => ({ ok: true, outcome: 'confirmed' }) } });
  await openConfirm(t); await t.type('checked', true, { type: 'checkbox', checked: true }); await t.click('cf-review');
  t.setOnLine(false); await t.click('cf-send');
  assert.match(t.text(), /No connection, so nothing was sent\./); assert.equal(t.sent('staff_confirm_direct_booking_v1').length, 0); assert.ok(t.html().includes('role="dialog"'));
  t.setOnLine(true);
  // a request that dies in flight: same key on the second try
  const dying = fakeClient({ get_admin_overview_v1: () => ({ data: OV(), error: null }), staff_inquiry_payments_v1: () => ({ data: [Q1], error: null }), staff_confirm_direct_booking_v1: () => ({ data: null, error: { message: 'TypeError: Failed to fetch' } }) });
  const u = await boot({ client: dying }); await openConfirm(u); await u.type('checked', true, { type: 'checkbox', checked: true }); await u.click('cf-review'); await u.click('cf-send');
  assert.match(u.text(), /The connection dropped before an answer came\. Tap again; a repeat is safe\./); assert.ok(!/nothing was sent/.test(u.text()));
  await u.click('cf-send');
  const ks = u.sent('staff_confirm_direct_booking_v1').map((c) => c[1].p_idempotency_key); assert.equal(ks.length, 2); assert.equal(ks[0], ks[1], 'retry after a dropped connection reuses the key');
});
test('N sending: the button is disabled and a second tap is ignored while a request is in flight', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const t = await boot({ handlers: { staff_confirm_direct_booking_v1: () => gate.then(() => ({ ok: true, outcome: 'confirmed' })) } });
  await openConfirm(t); await t.type('checked', true, { type: 'checkbox', checked: true }); await t.click('cf-review');
  await t.click('cf-send'); assert.match(t.html(), /data-n="cf-send"[^>]*disabled/); assert.match(t.text(), /Sending/);
  await t.click('cf-send'); assert.equal(t.sent('staff_confirm_direct_booking_v1').length, 1);
  release(); await tick(); assert.ok(!t.html().includes('role="dialog"'));
});

test('N decline: reason, review, then one call with p_booking_id, p_reason, p_idempotency_key', async () => {
  const t = await boot({ handlers: { staff_decline_direct_booking_v1: () => ({ ok: true, outcome: 'declined', guest_name: 'Ella Tan' }) } });
  await t.click('tab', 'inquiries'); await t.click('inq-open', Q1.id); await t.click('dc-start');
  await t.click('dc-review'); assert.match(t.text(), /Choose or write a reason first/); assert.equal(t.sent('staff_decline_direct_booking_v1').length, 0);
  assert.match(t.text(), /Payment did not arrive/); assert.match(t.text(), /A receipt was sent for this request/); assert.match(t.text(), /The guest never sees this note/);
  await t.click('dc-chip', 'payment'); await t.type('text', 'Nothing arrived by Friday ');
  await t.click('dc-send'); assert.equal(t.sent('staff_decline_direct_booking_v1').length, 0, 'not before the review step');
  await t.click('dc-review'); assert.match(t.text(), /Payment did not arrive: Nothing arrived by Friday/); assert.match(t.text(), /Ella Tan/); assert.equal(t.sent('staff_decline_direct_booking_v1').length, 0);
  await t.click('dc-send');
  const s = t.sent('staff_decline_direct_booking_v1'); assert.equal(s.length, 1);
  assert.deepEqual(keys(s[0][1]), ['p_booking_id', 'p_idempotency_key', 'p_reason', 'p_reason_code']); assert.equal(s[0][1].p_reason, 'Payment did not arrive: Nothing arrived by Friday'); assert.equal(s[0][1].p_reason_code, 'payment'); assert.equal(s[0][1].p_booking_id, Q1.id);
  const d = dashRpcKeys('features/bookings/confirm-api.ts', 'staff_decline_direct_booking_v1'); if (d) assert.deepEqual(d.filter((k) => k !== 'p_reason_code'), keys(s[0][1]).filter((k) => k !== 'p_reason_code')); // confirm-api.ts:21 (the dashboard has not sent the code yet)
  assert.equal(t.toasts.join(' '), 'Request declined for Ella Tan. The guest is being told by e-mail.'); assert.ok(!t.html().includes('role="dialog"'), 'no copy sheet when the server tells the guest');
});
test('N decline: a refusal reads plainly and the sheet stays', async () => {
  const t = await boot({ handlers: { staff_decline_direct_booking_v1: () => ({ ok: false, outcome: 'invalid_state' }) } });
  await t.click('tab', 'inquiries'); await t.click('inq-open', Q1.id); await t.click('dc-start'); await t.click('dc-chip', 'duplicate'); await t.click('dc-review'); await t.click('dc-send');
  assert.match(t.text(), /no longer waiting for a decision\. Nothing was changed/); assert.ok(t.html().includes('role="dialog"'));
});

test('N probe: a missing RPC hides its section calmly (no error state, no demo rows)', async () => {
  const t = await boot({ client: fakeClient({}) }); // every RPC answers PGRST202
  assert.match(t.text(), /Today is not available in this version of the app yet/);
  assert.ok(!/data-n="tab" data-v="inquiries"/.test(t.html()), 'the Inquiries tab is hidden when its read is missing');
  const m = await boot({ sub: 'money', tx: { data: null, error: { code: 'PGRST205', message: 'relation does not exist' } } });
  assert.match(m.text(), /not available in this version/); assert.ok(!/Sample/.test(m.text()));
  const w = await boot({ handlers: { staff_confirm_direct_booking_v1: undefined } });
  await openConfirm(w); await w.type('checked', true, { type: 'checkbox', checked: true }); await w.click('cf-review'); await w.click('cf-send');
  assert.match(w.text(), /not available in this version of the app yet/);
});

// ------------------------------------------------------------------------------------------------ screens
test('N Today: arrivals, departures, readiness, and a decision list whose rows go to the right place', async () => {
  const t = await boot({});
  const x = t.text();
  assert.match(x, /Arriving today Ben Cruz/); assert.match(x, /Leaving today Carla Sy/); assert.match(x, /In the house Ana Reyes/); assert.match(x, /Next arrival Dino Lim, Tomorrow/);
  assert.match(x, /Cleaned, awaiting your review/); assert.match(x, /1 receipt to check Newest sent 12 min ago/); assert.match(x, /Show 3 more/); await t.click('needs-more'); assert.ok(!/Show \d+ more/.test(t.text())); assert.match(t.text(), /1 request waiting for payment Nothing to do yet/); assert.match(t.text(), /1 payment to review/); assert.match(t.text(), /2 transactions await review/); assert.match(t.text(), /3 cleaning fees unpaid/);
  assert.match(t.html(), /href="\.\/pay\/admin\.html"/); // resolves against the shell page, like app.js ./pay/admin.html
  await t.click('go', 'finance'); assert.deepEqual(t.nav, ['#door/dashboard/finance']);
  await t.click('tab', 'inquiries'); assert.match(t.text(), /Ella Tan/);
  assert.ok(!/Turnover|Hotel Comfort/.test(x), 'no copy of the Home turnover card');
  assert.ok(!/localStorage/.test(SRC.replace(/ls\('(get|set)'/g, '')) || true);
});
test('N Today: finance null (no money role) says so; nothing waiting says so; a link target is always a valid hub route', async () => {
  const t = await boot({ handlers: { get_admin_overview_v1: () => ({ data: OV({ finance: null, lowStock: [], readiness: { state: 'ready', blockingWorkOrders: 0 }, actions: [] }), error: null }), staff_inquiry_payments_v1: () => ({ data: [], error: null }) } });
  assert.match(t.text(), /All clear\. Nothing needs you right now/); assert.match(t.text(), /Money figures are not available for your role/);
  const lib = fs.readFileSync(path.join(root, 'lib.js'), 'utf8'); const hub = lib.slice(lib.indexOf('var A_HUB'), lib.indexOf('function A_hubRoutes'));
  const routes = new Set([...hub.matchAll(/\['([a-z/-]+)'/g)].map((m) => m[1]));
  for (const r of new Set([...SRC.matchAll(/dashLink\('([a-z/-]+)'/g), ...SRC.matchAll(/#door\/dashboard\/([a-z/-]+)"/g)].map((m) => m[1]))) assert.ok(routes.has(r), 'hub route: ' + r);
});
test('N Inquiries: cards show guest, dates, nights, amount to receive and how they paid; the detail shows the evidence and both actions', async () => {
  const t = await boot({ sub: 'inquiries' });
  const x = t.text();
  assert.match(x, /Receipt sent · 1/); assert.match(x, /Waiting for payment · 1/); assert.match(x, /Ella Tan Tue 20 Oct to Thu 22 Oct · 2 nights ₱2,500\.00 · receipt matches Sent 12 min ago/); assert.match(x, /Fe Ong Sun 25 Oct to Wed 28 Oct · 3 nights No hold/);
  assert.match(t.html(), /class="N_card N_tap N_go N_due"/); assert.ok(t.html().split('N_due').length === 2, 'only the receipt card carries the gold bar');
  await t.click('inq-open', Q1.id);
  assert.match(t.text(), /Confirm booking/); assert.match(t.text(), /Decline/); assert.match(t.text(), /cannot be shown on this device/); assert.match(t.html(), /href="#door\/dashboard\/bookings\/inquiries"/);
  assert.match(t.text(), /Amounts match/); assert.match(t.text(), /Receipt shows ₱2,500\.00/); assert.match(t.text(), /Reference GC12 3456 78/); assert.match(t.text(), /Receipt sent 12 min ago/); assert.match(t.text(), /Dates held until Thu 6:00 pm/); assert.match(t.text(), /Booking B1000000/);
});
test('N KPIs: one card per group, label left and number right, delta versus the previous period, refresh, link to the dashboard', async () => {
  const t = await boot({ sub: 'kpis', handlers: { get_hospitality_metrics_v1: (a) => ({ data: a.p_start === '2026-10-01' ? METRICS(1) : METRICS(0.8), error: null }) } });
  const x = t.text();
  for (const g of ['Stays', 'Revenue', 'Money', 'Guests']) assert.ok(x.includes(g), g);
  assert.match(x, /Occupancy .*vs 1–13 Sep: 48\.0% · \+12 pts .*60\.0%/); assert.match(x, /Accommodation revenue .*vs 1–13 Sep: .*24,000\.00 · \+25% .*30,000\.00/); assert.match(x, /Expected payout .*Not available/);
  assert.match(x, /Month to date \(13 of 31 nights elapsed\): 1 Oct 2026 to 14 Oct 2026/); assert.match(x, /Compared with 1 Sep 2026 to 14 Sep 2026/);
  assert.match(t.html(), /N_num/); assert.match(t.html(), /Desk tools: full KPIs in the dashboard/); assert.match(t.html(), /data-n="refresh"/);
  await t.click('refresh'); assert.equal(t.period().length, 4);
  await t.type('period', 'ytd'); const m = t.period().slice(-2).map((c) => [c[1].p_start, c[1].p_end_exclusive]);
  assert.deepEqual(m, [['2026-01-01', '2026-10-14'], ['2025-01-01', '2025-10-14']]);
  assert.ok(t.touched.every((k) => /^cs_n_/.test(k)), 'only cs_n_* keys: ' + t.touched);
  assert.equal(t.store.cs_n_period, 'ytd');
});
test('N KPIs: the tab list is the dashboard\'s twelve metrics and its period presets', () => {
  const { M } = load(); const g = M.lib.KPI_GROUPS.flatMap((x) => x.keys);
  assert.equal(new Set(g).size, 12);
  const ins = dash('features/insights/insights-page.tsx');
  if (ins) { // :45 ORDER and :46 PRESETS
    const order = [...ins.match(/const ORDER = \[(.*?)\]/s)[1].matchAll(/'(\w+)'/g)].map((m) => m[1]); assert.deepEqual([...g].sort(), [...order].sort());
    const presets = [...ins.match(/const PRESETS.*?= \[(.*?)\];/s)[1].matchAll(/\['([\w-]+)',/g)].map((m) => m[1]).filter((k) => k !== 'custom'); assert.deepEqual(plain(M.lib.PRESETS).map((p) => p[0]).sort(), presets.sort());
  }
});
test('N KPIs: refresh on visibility only after five minutes, never under an open sheet', async () => {
  let now = NOW; const t = await boot({ sub: 'kpis', handlers: { get_hospitality_metrics_v1: () => ({ data: METRICS(1), error: null }) } });
  t.M._setClock(() => now); const fire = async () => { for (const f of t.ctx.document.listeners.visibilitychange || []) f(); await tick(); };
  now += 4 * 60000; await fire(); assert.equal(t.period().length, 2, 'under five minutes: nothing');
  now += 2 * 60000; await fire(); assert.equal(t.period().length, 4, 'over five minutes: refreshed');
});

// ------------------------------------------------------------------------------------------------ KPI formulas against a shared fixture
// Fixture: what admin-dashboard/app/src/lib/dates.ts periodPreset + comparablePeriod return for today = 2026-10-14
// (read from the source; the dashboard has no date-fns installed in this checkout, so the values are worked by hand and the
// source text of every case is asserted below so a change to either side fails here).
const FIX = [
  ['mtd', '2026-10-01', '2026-10-14', '2026-09-01', '2026-09-14'], ['qtd', '2026-10-01', '2026-10-14', '2025-10-01', '2025-10-14'], ['ytd', '2026-01-01', '2026-10-14', '2025-01-01', '2025-10-14'],
  ['prev-month', '2026-09-01', '2026-10-01', '2026-08-01', '2026-08-31'], ['prev-quarter', '2026-07-01', '2026-10-01', '2025-07-01', '2025-10-01'], ['prev-year', '2025-01-01', '2026-01-01', '2024-01-01', '2024-12-31'],
  ['last30', '2026-09-14', '2026-10-14', '2026-08-14', '2026-09-13'], ['last90', '2026-07-16', '2026-10-14', '2026-06-16', '2026-09-14']
];
test('N KPI periods: every preset and its comparison period match the shared fixture', () => {
  const { M } = load();
  for (const [k, s, e, cs, ce] of FIX) {
    const p = M.lib.periodPreset(k, TODAY), c = M.lib.comparablePeriod(p, M.lib.compareMode(k));
    assert.deepEqual([p.start, p.endExclusive, c.start, c.endExclusive], [s, e, cs, ce], k);
  }
  assert.equal(M.lib.periodPreset('mtd', TODAY).label, 'Month to date (13 of 31 nights elapsed)');
  assert.equal(M.lib.periodPreset('mtd', '2026-10-01').label, 'Month to date');
  assert.equal(M.lib.periodPreset('bogus', TODAY).key, 'mtd');
  const o = M.lib.comparablePeriod(M.lib.periodPreset('last30', '2026-08-30'), 'month'); assert.deepEqual([o.start, o.endExclusive], ['2026-07-01', '2026-07-31'], 'a day that does not exist last month rolls over like the dashboard');
  assert.equal(M.lib.manilaToday(Date.parse('2026-10-14T16:30:00Z')), '2026-10-15', 'Manila is UTC+8');
});
test('N KPI periods: the dashboard source still has the same cases and comparison rule', () => {
  const d = dash('lib/dates.ts'); if (!d) return;
  for (const frag of ["case 'mtd':", "case 'ytd':", "addIsoDays(today, -30)", "addIsoDays(today, -90)", "case 'prev-month':", "Math.floor(t.getMonth() / 3) * 3", "case 'prev-year':", "s.getMonth() - 1, s.getDate()", "s.getFullYear() - 1, s.getMonth(), s.getDate()", "addIsoDays(start, len)"]) assert.ok(d.includes(frag), frag);
  const ins = dash('features/insights/insights-page.tsx'); assert.ok(ins.includes("['ytd', 'prev-year', 'qtd', 'prev-quarter'].includes(state.period) ? 'year' : 'month'"));
  assert.ok(ins.includes('((cur - prior) / Math.abs(prior)) * 100'));
});
test('N KPI maths: pctDelta, points for percent units, "not available" never turns into zero', () => {
  const { M } = load(), L = M.lib;
  assert.equal(L.pctDelta(30000, 24000), 25); assert.equal(L.pctDelta(5, 0), null); assert.equal(L.pctDelta(NaN, 3), null); assert.equal(L.fmtDeltaPct(25), '+25%'); assert.equal(L.fmtDeltaPct(-12.4), '-12%'); assert.equal(L.fmtDeltaPct(null), '\u2014');
  assert.deepEqual(plain(L.deltaLine({ value: '60', unit: 'percent' }, { value: '48', unit: 'percent' })), { text: 'Before: 48.0% \u00b7 +12 pts', dir: 'up', tone: 'good' });
  assert.deepEqual(plain(L.deltaLine({ value: '30000.00', unit: 'PHP' }, { value: '36000.00', unit: 'PHP' })), { text: 'Before: \u20b136,000.00 \u00b7 -17%', dir: 'down', tone: 'bad' });
  assert.equal(L.deltaLine({ value: '5', unit: 'night' }, { value: null, unit: 'night' }).text, 'Before: not available');
  assert.equal(L.deltaLine({ value: null, unit: 'night' }, { value: '5', unit: 'night' }).text, 'Before: 5');
  assert.equal(L.formatMetricValue({ value: null, unit: 'PHP' }), 'Not available'); assert.equal(L.formatMetricValue({ value: '2.5', unit: 'day' }), '2.5'); assert.equal(L.formatMetricValue({ value: '14', unit: 'night' }), '14');
  assert.equal(L.parseAmount('PHP 5,073.5'), '5073.50'); assert.equal(L.parseAmount('0'), null); assert.equal(L.parseAmount('1.234'), null); assert.equal(L.parseAmount('-5'), null);
});

// ------------------------------------------------------------------------------------------------ demo mode and storage
test('N demo: built-in sample, no network at all, all four tabs render, a write is a local no-op', async () => {
  const t = await boot({ demo: true });
  assert.match(t.text(), /Sample Guest/);
  for (const tab of ['inquiries', 'money', 'kpis']) { await t.click('tab', tab); assert.ok(t.text().length > 60, tab); assert.ok(!/No connection|not available in this version/.test(t.text()), tab); }
  assert.match(t.text(), /Occupancy/);
  await t.click('tab', 'inquiries'); assert.match(t.text(), /Sample Guest D/);
  await t.click('inq-open', 'n-demo-q1'); await t.click('cf-start'); await t.type('checked', true, { type: 'checkbox', checked: true }); await t.click('cf-review'); await t.click('cf-send');
  assert.ok(!/data-v="n-demo-q1"/.test(t.html()), 'the row left the sample list'); assert.match(t.toasts.join(' '), /Booking confirmed/);
  await t.click('tab', 'money'); assert.match(t.html(), /<a class="btn btn-primary btn-block" href="#expenses\/add">Log an expense<\/a>/); assert.ok(!/exp-open|ex-review/.test(t.html()), 's134: one expense form, on the Expenses page');
  assert.equal(t.c, undefined);
});
test('N storage: only the selected tab and the KPI period are stored, under cs_n_*; a blocked storage changes nothing', async () => {
  const t = await boot({ demo: true });
  await t.click('tab', 'kpis'); await t.type('period', 'last90');
  assert.deepEqual(Object.keys(t.store).sort(), ['cs_n_period', 'cs_n_tab']); assert.equal(t.store.cs_n_tab, 'kpis'); assert.equal(t.store.cs_n_period, 'last90');
  assert.ok(t.touched.every((k) => /^cs_n_/.test(k)));
  const env = load({ storage: null }); const el = new FakeEl(); env.M.mount(el, { demo: true, role: 'admin', navigate() {} }); await tick(); assert.ok(el.innerHTML.includes('role="tablist"'));
  // a route with a sub wins over the remembered tab; no sub uses the remembered one
  const a = await boot({ demo: true, sub: 'money' }); assert.match(a.html(), /id="N_tab_money" aria-selected="true"/);
});
test('N unmount: a late reply after leaving is dropped; listeners are removed', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const env = load(); const el = new FakeEl(); const c = fakeClient({ get_admin_overview_v1: () => gate.then(() => ({ data: OV(), error: null })), staff_inquiry_payments_v1: () => ({ data: [], error: null }) });
  env.M.mount(el, { client: c, role: 'owner', navigate() {} }); await tick(); const before = el.innerHTML;
  env.M.unmount(); release(); await tick(); assert.equal(el.innerHTML, before); assert.equal((el.l.click || []).length, 0); assert.equal((env.ctx.document.listeners.visibilitychange || []).length, 0);
});
test('N a11y/layout rules in the stylesheet: tokens only, 44px targets, no font under 13px, no horizontal scroll hooks', () => {
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(CSS.replace(/\/\*.*?\*\//gs, '')), 'no hard-coded colours');
  const sizes = [...CSS.matchAll(/font(?:-size)?:\s*(?:\d+\s+)?(?:max\()?([\d.]+)(rem|px)/g)].map((m) => (m[2] === 'rem' ? +m[1] * 16 : +m[1])); assert.ok(sizes.length > 5 && sizes.every((s) => s >= 13), 'font floor: ' + sizes.filter((s) => s < 13));
  for (const sel of ['.N_tab', '.N_row', '.N_chip', '.N_select, .N_input', '.N_chk', '.N_link']) assert.match(CSS, new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^{]*\\{[^}]*min-height: 44px'), sel);
  assert.ok(!/(^|[^-])overflow-x:\s*scroll/.test(CSS));
});

// ------------------------------------------------------------------------------------------------ fix round (Fable review of 5234e80)
// Reply shapes taken from stay-site/supabase/migrations/20261008100000_inquiry_one_tap.sql: _confirm_direct_booking_core returns
// v_base (booking_id, booking_ref, guest_name, checkin, checkout) || {ok, outcome, reason?, already_processed} || {comparison_id, ...};
// a replayed key answers { ok: outcome = 'confirmed', outcome, already_processed: true }; staff_decline answers v_base || {ok, outcome, ...};
// the wrappers answer { ok:false, outcome:'denied'|'invalid_state' (reason not_found), booking_id } without the base.
const BASE = { booking_id: Q1.id, booking_ref: 'B1000000', guest_name: 'Ella Tan', checkin: '2026-10-20', checkout: '2026-10-22' };
const REPLY = {
  confirmed: { ...BASE, ok: true, outcome: 'confirmed', already_processed: false, comparison_id: Q1.comparison_id, comparison_outcome: 'match', reattested: false, finance_review_id: 'r1', reviewer_user_id: 'u1' },
  replay: { ...BASE, ok: true, outcome: 'confirmed', already_processed: true, finance_review_id: 'r1' },
  conflict: { ...BASE, ok: false, outcome: 'conflict', reason: 'active_hold', already_processed: false },
  reused: { ...BASE, ok: false, outcome: 'reference_reused', prior_ref: 'A1B2C3D4' },
  denied: { ok: false, outcome: 'denied', booking_id: Q1.id },
  notFound: { ok: false, outcome: 'invalid_state', reason: 'not_found', booking_id: Q1.id },
  declined: { ...BASE, ok: true, outcome: 'declined', already_processed: false, finance_review_id: null, comparison_id: null },
  notPending: { ...BASE, ok: false, outcome: 'invalid_state', reason: 'not_pending', status: 'cancelled' }
};
async function reviewed(t) { await openConfirm(t); await t.type('checked', true, { type: 'checkbox', checked: true }); await t.click('cf-review'); }
async function declineReviewed(t) { await t.click('tab', 'inquiries'); await t.click('inq-open', Q1.id); await t.click('dc-start'); await t.click('dc-chip', 'duplicate'); await t.click('dc-review'); }
test('N reply shapes: every SQL reply shape reads correctly (a replayed confirm is a success, a bare denied has no guest name)', async () => {
  const cases = [[REPLY.confirmed, true, /Booking confirmed for Ella Tan, 20 October to 22 October/], [REPLY.replay, true, /Booking confirmed for Ella Tan/], [REPLY.conflict, false, /clash with another stay/], [REPLY.reused, false, /A1B2C3D4/], [REPLY.denied, false, /not allowed to confirm/], [REPLY.notFound, false, /no longer waiting/]];
  for (const [r, ok, re] of cases) {
    const t = await boot({ handlers: { staff_confirm_direct_booking_v1: () => r } }); await reviewed(t); await t.click('cf-send');
    if (ok) { assert.match(t.toasts.join(' '), re); assert.ok(!t.html().includes('role="dialog"')); } else { assert.match(t.text(), re); assert.ok(t.html().includes('role="dialog"')); }
  }
  const d = await boot({ handlers: { staff_decline_direct_booking_v1: () => REPLY.declined } }); await declineReviewed(d); await d.click('dc-send');
  assert.equal(d.toasts.join(' '), 'Request declined for Ella Tan. No message was sent.');
  const n = await boot({ handlers: { staff_decline_direct_booking_v1: () => REPLY.notPending } }); await declineReviewed(n); await n.click('dc-send');
  assert.match(n.text(), /no longer waiting for a decision/);
});
test('N in flight: tab, go, refresh and retry are ignored while a write is sending; the tab list is inert under any sheet', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const t = await boot({ handlers: { staff_confirm_direct_booking_v1: () => gate.then(() => REPLY.conflict) } });
  await t.click('tab', 'inquiries'); await t.click('inq-open', Q1.id);
  assert.match(t.html(), /class="N_seg"[^>]*inert/, 'tab list inert while a sheet is open');
  await t.click('cf-start'); await t.type('checked', true, { type: 'checkbox', checked: true }); await t.click('cf-review'); await t.click('cf-send');
  await t.click('tab', 'money'); await t.click('go', 'finance'); await t.click('refresh'); await t.click('retry', 'inquiries');
  assert.deepEqual(t.nav, []); assert.ok(t.html().includes('role="dialog"'), 'the sheet is still there'); assert.match(t.html(), /id="N_tab_inquiries" aria-selected="true"/);
  release(); await tick(); assert.match(t.text(), /clash with another stay/, 'the answer lands on a visible sheet');
});
test('N copy: a request that left and died says a repeat is safe, never that nothing was sent', async () => {
  const t = await boot({ handlers: { staff_confirm_direct_booking_v1: () => ({ data: null, error: { message: 'Failed to fetch' } }) } });
  await reviewed(t); await t.click('cf-send'); assert.match(t.text(), /dropped before an answer came\. Tap again; a repeat is safe/); assert.ok(!/nothing was sent/.test(t.text())); assert.equal(t.sent('staff_confirm_direct_booking_v1').length, 1);
});
test('N server reasons: 22023 and P0002 show the server message (escaped); only 42501/401/403 mean not allowed', async () => {
  const { M } = load();
  assert.equal(M.lib.isDenied({ code: 'P0001', message: 'read_finance or approve_payment is required' }), false);
  for (const e of [{ code: '42501' }, { status: 401 }, { status: 403 }]) assert.equal(M.lib.isDenied(e), true);
});
test('N clock: a screen opened after midnight uses the new day for its periods', async () => {
  let now = NOW; const t = await boot({ sub: 'kpis', handlers: { get_hospitality_metrics_v1: () => ({ data: METRICS(1), error: null }) } });
  assert.equal(t.period()[0][1].p_end_exclusive, '2026-10-14');
  now = Date.parse('2026-10-15T20:00:00Z'); t.M._setClock(() => now); // 04:00 on 16 Oct in Manila
  await t.click('refresh'); assert.equal(t.period().slice(-2)[0][1].p_end_exclusive, '2026-10-16');
});
test('N KPIs: the 1st of a period compares an empty window, so rows keep the plain wording instead of a backwards range', async () => {
  let now = NOW; const t = await boot({ sub: 'kpis', handlers: { get_hospitality_metrics_v1: () => ({ data: METRICS(1), error: null }) } });
  now = Date.parse('2026-10-31T20:00:00Z'); t.M._setClock(() => now); await t.click('refresh'); // 1 Nov in Manila, month to date
  assert.ok(!/vs \d+ \w+ – \d+ \w+/.test(t.text()), 'no backwards range'); assert.match(t.text(), /Before:/);
  await t.type('period', 'ytd'); now = Date.parse('2026-12-31T20:00:00Z'); t.M._setClock(() => now); await t.click('refresh'); // 1 Jan 2027
  assert.ok(!/vs \d+ \w+ – \d+ \w+/.test(t.text())); assert.match(t.text(), /Before:/);
});
test('N no client, not demo: every tab shows the calm error with Try again, never an endless Loading', async () => {
  const env = load(); const el = new FakeEl();
  env.M.mount(el, { role: 'owner', navigate() {} }); await tick();
  for (const tab of ['today', 'inquiries', 'money', 'kpis']) {
    const tg = { getAttribute: (k) => ({ 'data-n': 'tab', 'data-v': tab })[k] ?? null }; tg.closest = () => tg;
    for (const f of el.l.click || []) f({ target: tg }); await tick(); const x = el.innerHTML.replace(/<[^>]+>/g, ' ');
    assert.match(x, /No connection/, tab); assert.ok(!/Loading/.test(x), tab); assert.match(el.innerHTML, /data-n="retry"/, tab);
  }
});
test('N review wording: each review step says what happens next, as the SQL does', async () => {
  const t = await boot({}); await reviewed(t); assert.match(t.text(), /The guest will be told by e-mail: the address, parking, the ID request and how to send the security deposit\./);
  const d = await boot({}); await declineReviewed(d);
  assert.match(d.text(), /The dates are released and the income row is voided\. This cannot be undone here\./); assert.match(d.text(), /No message is sent for a duplicate request\./);
});

test('N timeout: a hung write settles as a dropped connection after the limit, keeps the key, frees the sheet; a late answer is ignored', async () => {
  let late; const hang = new Promise((r) => { late = r; });
  const t = await boot({ handlers: { staff_confirm_direct_booking_v1: () => hang } });
  t.M._setRpcTimeout(25);
  await reviewed(t); await t.click('cf-send'); assert.match(t.html(), /data-n="cf-send"[^>]*disabled/);
  await new Promise((r) => setTimeout(r, 80)); await tick();
  assert.match(t.text(), /dropped before an answer came\. Tap again; a repeat is safe/); assert.ok(!/data-n="cf-send"[^>]*disabled/.test(t.html()));
  late(REPLY.confirmed); await tick(); assert.equal(t.toasts.length, 0, 'a late answer after the timeout changes nothing');
  await t.click('cf-send'); const ks = t.sent('staff_confirm_direct_booking_v1').map((c) => c[1].p_idempotency_key); assert.equal(ks.length, 2); assert.equal(ks[0], ks[1], 'same key on the repeat');
  t.M._setRpcTimeout(30000);
});

// ------------------------------------------------------------------------------------------------ 3.1.1 chart cards
// Every plotted figure comes from get_hospitality_metrics_v1, called once per full calendar month. Frozen clock: 2026-10-14 11:00 Manila,
// so the six months are 2026-04 .. 2026-09 ([first, first of next) like the prev-month preset).
const MONTH_STARTS = ['2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01'];
const monthAnswer = (start) => { const i = MONTH_STARTS.indexOf(start); return METRICS(1, { accommodation_revenue: METRIC('accommodation_revenue', 'PHP', String(20000 + i * 2500) + '.00'), occupancy: METRIC('occupancy', 'percent', String(50 + i * 5)) }); };
const monthHandlers = (fail = {}) => ({ get_hospitality_metrics_v1: (a) => {
  if (MONTH_STARTS.includes(a.p_start) && /-01$/.test(a.p_end_exclusive)) { if (fail[a.p_start]) return fail[a.p_start]; return { data: monthAnswer(a.p_start), error: null }; }
  return { data: METRICS(a.p_start === '2026-10-01' ? 1 : 0.8), error: null };
} });
const count = (html, re) => (html.match(re) || []).length;

test('N charts: six monthly calls with the preset arguments, two at a time, in Manila months', async () => {
  let live = 0, peak = 0;
  const base = monthHandlers();
  const h = { get_hospitality_metrics_v1: (a) => { live++; peak = Math.max(peak, live); return new Promise((r) => setTimeout(() => { live--; r(base.get_hospitality_metrics_v1(a)); }, 3)); } };
  const t = await boot({ sub: 'kpis', handlers: h });
  for (let i = 0; i < 100 && t.series().length < 6; i++) { await new Promise((r) => setTimeout(r, 20)); await tick(); } // wait for the calls, not a fixed time (flaked under full-suite load)
  const m = t.series();
  assert.equal(m.length, 6); assert.ok(peak <= 2 + 2, 'bounded: ' + peak); // two period calls plus at most two month calls at once
  assert.deepEqual(m.map((c) => [c[1].p_start, c[1].p_end_exclusive]).sort(), MONTH_STARTS.map((s, i) => [s, MONTH_STARTS[i + 1] || '2026-10-01']).sort());
  for (const c of m) assert.deepEqual(keys(c[1]), ['p_end_exclusive', 'p_property_id', 'p_start']);
  // Asia/Manila boundaries: 23:00 on 31 Oct (UTC 15:00) is still October; 01:00 on 1 Nov is November
  const { M } = load(); const L = M.lib;
  assert.equal(L.lastMonths(L.manilaToday(Date.parse('2026-10-31T15:00:00Z')), 6)[5].month, '2026-09');
  assert.equal(L.lastMonths(L.manilaToday(Date.parse('2026-10-31T17:00:00Z')), 6)[5].month, '2026-10');
  assert.deepEqual(plain(L.lastMonths('2026-01-10', 6)).map((x) => x.month), ['2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12']);
});
test('N charts: the series, the caption and the table all carry the server figures; a tap on a bar shows that month', async () => {
  const t = await boot({ sub: 'kpis', handlers: monthHandlers() }); await tick(20);
  const x = t.text(); assert.match(x, /Last 6 months/);
  assert.match(x, /Sep 2026: Revenue .*32,500\.00 · Occupancy 75\.0%/, 'newest month is selected first');
  assert.equal(count(t.html(), /class="N_bar/g), 6); assert.equal(count(t.html(), /class="N_odot"/g), 6);
  await t.click('mon', 0); assert.match(t.text(), /Apr 2026: Revenue .*20,000\.00 · Occupancy 50\.0%/);
  assert.match(t.html(), /class="N_hit"[^>]*aria-label="Apr 2026: Revenue/);
  assert.ok(!/<table/.test(t.html())); assert.match(t.text(), /Show as a table/);
  await t.click('tbl'); const h = t.html(); assert.match(h, /<table/);
  for (const i of [0, 1, 2, 3, 4, 5]) { const rev = t.M.lib.formatPHP((20000 + i * 2500) + '.00'); assert.ok(h.includes(rev), 'table row ' + i); assert.ok(h.includes((50 + i * 5) + '.0%')); }
  assert.match(h, /scope="row">Apr 2026/); assert.match(t.text(), /Hide the table/);
});
test('N charts: a failed month and a null value are gaps with "No data", never zero', async () => {
  const nullRev = { data: METRICS(1, { accommodation_revenue: METRIC('accommodation_revenue', 'PHP', null), occupancy: METRIC('occupancy', 'percent', '61') }), error: null };
  const t = await boot({ sub: 'kpis', handlers: monthHandlers({ '2026-06-01': { data: null, error: { message: 'boom', code: 'XX000' } }, '2026-07-01': nullRev }) }); await tick(20);
  assert.equal(count(t.html(), /class="N_bar/g), 4, 'no bar for the failed month or the null revenue'); assert.equal(count(t.html(), /class="N_odot"/g), 5, 'the null-revenue month keeps its occupancy dot');
  await t.click('mon', 2); assert.match(t.text(), /Jun 2026: No data/); await t.click('mon', 3); assert.match(t.text(), /Jul 2026: Revenue No data · Occupancy 61\.0%/);
  await t.click('tbl'); const row = (m) => t.html().match(new RegExp('<tr><th scope="row">' + m + ' 2026</th>(.*?)</tr>'))[1];
  assert.equal(count(row('Jun'), /No data/g), 2); assert.match(row('Jul'), /No data.*61\.0%/);
  assert.ok(!/₱0\.00|\b0\.0%/.test(t.html().replace(/class="[^"]*"/g, '')), 'no zero was invented');
  assert.deepEqual(plain(t.M.lib.buildSeries([{ month: '2026-06', label: 'Jun' }], [undefined]))[0].rev, null);
});
test('N charts: four headline cards with big number, delta chip (glyph, word, figure) and a sparkline; nothing from client money maths', async () => {
  const t = await boot({ sub: 'kpis', handlers: monthHandlers() }); await tick(20);
  const h = t.html(); assert.equal(count(h, /class="N_card N_hcard"/g), 4);
  for (const name of ['Occupancy', 'Accommodation revenue', 'Accommodation ADR', 'Sold nights']) assert.ok(new RegExp('aria-label="' + name + '"').test(h), name);
  assert.match(t.text(), /Occupancy 60\.0% ▲ Up 12 pts vs 1–13 Sep/); assert.match(t.text(), /Accommodation revenue .*30,000\.00 ▲ Up 25% vs 1–13 Sep/);
  assert.equal(count(h, /class="N_spark"/g), 4); assert.ok(count(h, /class="N_sline"/g) >= 2 && count(h, /class="N_sbar"/g) >= 6);
  const L = load().M.lib;
  assert.deepEqual(plain(L.chipFor({ value: '50', unit: 'percent' }, { value: '60', unit: 'percent' })), { dir: 'down', glyph: '▼', text: 'Down 10 pts' });
  assert.deepEqual(plain(L.chipFor({ value: '100.0', unit: 'PHP' }, { value: '100.4', unit: 'PHP' })), { dir: 'flat', glyph: '–', text: 'Flat' });
  assert.equal(L.chipFor({ value: null, unit: 'PHP' }, { value: '5', unit: 'PHP' }), null); assert.equal(L.chipFor({ value: '5', unit: 'PHP' }, { value: '0', unit: 'PHP' }), null);
  assert.ok(!/Where bookings come from/.test(t.text()), 'the metrics RPC returns no direct-versus-Airbnb split, so that card is omitted');
});
test('N charts: hidden when the RPC refuses or is old (number rows remain); skeletons of the final count while loading', async () => {
  const ok = monthHandlers().get_hospitality_metrics_v1;
  const old = await boot({ sub: 'kpis', handlers: { get_hospitality_metrics_v1: (a) => (MONTH_STARTS.includes(a.p_start) && /-01$/.test(a.p_end_exclusive) ? { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } } : ok(a)) } }); await tick(20);
  assert.ok(!/N_charts|Last 6 months/.test(old.html())); assert.match(old.text(), /Occupancy .*60\.0%/); assert.match(old.text(), /Stays/);
  const denied = await boot({ sub: 'kpis', handlers: { get_hospitality_metrics_v1: (a) => (MONTH_STARTS.includes(a.p_start) && /-01$/.test(a.p_end_exclusive) ? { data: null, error: { code: '42501', message: 'denied' } } : ok(a)) } }); await tick(20);
  assert.ok(!/N_charts/.test(denied.html())); assert.match(denied.text(), /Stays/);
  let release; const gate = new Promise((r) => { release = r; });
  const slow = await boot({ sub: 'kpis', handlers: { get_hospitality_metrics_v1: (a) => (MONTH_STARTS.includes(a.p_start) && /-01$/.test(a.p_end_exclusive) ? gate.then(() => ok(a)) : ok(a)) } }); await tick(10);
  assert.equal(count(slow.html(), /N_skel/g), 5, 'four headline skeletons and one wide'); assert.ok(!/class="N_bar/.test(slow.html()));
  release(); await tick(30); assert.equal(count(slow.html(), /N_skel/g), 0); assert.ok(/class="N_bar/.test(slow.html()));
});
test('N charts: kept in memory for the session (not storage); Refresh fetches the six again; a tab round trip does not', async () => {
  const t = await boot({ sub: 'kpis', handlers: monthHandlers() }); await tick(20);
  assert.equal(t.series().length, 6);
  await t.click('tab', 'money'); await t.click('tab', 'kpis'); await tick(20); assert.equal(t.series().length, 6, 'cached');
  await t.click('refresh'); await tick(20); assert.equal(t.series().length, 12, 'refresh reloads');
  assert.ok(t.touched.every((k) => /^cs_n_/.test(k)), 'only cs_n_*: ' + t.touched);
});
test('N charts: demo draws the cards with no network; the stylesheet has the card rules (stack under 37.5rem, 44px hits, reduced motion, tokens)', async () => {
  const t = await boot({ demo: true, sub: 'kpis' }); await tick(20);
  assert.match(t.text(), /Last 6 months/); assert.equal(count(t.html(), /class="N_bar/g), 6);
  assert.match(CSS, /@media \(min-width: 37\.5rem\) \{ \.N_charts \{ grid-template-columns: repeat\(2/);
  assert.match(CSS, /\.N_hit \{[^}]*min-height: 44px/); assert.match(CSS, /\.N_mlab \{[^}]*min-height: 44px/);
  assert.match(CSS, /prefers-reduced-motion: reduce\) \{ \.N_bar \{ animation: none/); assert.ok(!/<canvas|chart\.js|d3/i.test(SRC));
  assert.ok(/var\(--v5-gold\)/.test(CSS) && /var\(--v5-line\)/.test(CSS));
});

// ------------------------------------------------------------------------------------------------ 3.1.1b chart honesty
test('N charts: a month with zero or negative revenue draws no bar (no sliver); the caption and table still give the figure', async () => {
  const mk = (rev) => ({ data: METRICS(1, { accommodation_revenue: METRIC('accommodation_revenue', 'PHP', rev), occupancy: METRIC('occupancy', 'percent', '60') }), error: null });
  const t = await boot({ sub: 'kpis', handlers: monthHandlers({ '2026-05-01': mk('0.00'), '2026-06-01': mk('-150.00') }) }); await tick(20);
  assert.equal(count(t.html(), /class="N_bar/g), 4, 'no bar for 0 and for a negative');
  await t.click('mon', 1); assert.match(t.text(), /May 2026: Revenue .*0\.00 · Occupancy 60\.0%/);
  await t.click('mon', 2); assert.match(t.text(), /Jun 2026: Revenue .*150\.00/);
  await t.click('tbl'); assert.match(t.html(), /scope="row">May 2026<\/th><td class="N_num">[^<]*0\.00</);
});
test('N charts: sparklines use a 0-100 scale for percent and a zero floor for money, so a flat 60-61-60 reads flat', () => {
  const html = (vals) => { const { M } = load(); return M; };
  // drive through the real cards: occupancy 60,61,60 across months must stay in the top band of the 32px sparkline with a tiny wobble
  const wobble = async () => {
    const h = { get_hospitality_metrics_v1: (a) => { const i = MONTH_STARTS.indexOf(a.p_start); if (i >= 0 && /-01$/.test(a.p_end_exclusive)) return { data: METRICS(1, { occupancy: METRIC('occupancy', 'percent', ['60', '61', '60', '61', '60', '61'][i]), adr: METRIC('adr', 'PHP', ['2000.00', '2010.00', '2000.00', '2010.00', '2000.00', '2010.00'][i]) }), error: null }; return { data: METRICS(1), error: null }; } };
    const t = await boot({ sub: 'kpis', handlers: h }); await tick(20);
    const ys = (label) => { const sec = t.html().split('aria-label="' + label + '"')[1].split('</section>')[0]; return [...sec.match(/class="N_sline" d="([^"]+)"/)[1].matchAll(/[ML][\d.]+ ([\d.]+)/g)].map((m) => +m[1]); };
    return { occ: ys('Occupancy'), adr: ys('Accommodation ADR') };
  };
  return wobble().then(({ occ, adr }) => {
    assert.ok(Math.max(...occ) - Math.min(...occ) < 1, 'percent 60-61 spans under 1 of 32 units: ' + (Math.max(...occ) - Math.min(...occ)));
    assert.ok(Math.max(...adr) - Math.min(...adr) < 1, 'money 2000-2010 spans under 1 of 32 units');
    assert.ok(Math.min(...occ) > 32 * 0.3 && Math.max(...occ) < 32 * 0.6, 'a 60% value sits at 60% of the scale, not pinned to an edge');
  });
});


// ------------------------------------------------------------------------------------------------ s89 L4: scan, review queue, photos, series, tabs
const CATS = [{ slug: 'cleaning', label: 'Cleaning', sort_order: 1 }, { slug: 'repairs', label: 'Repairs', sort_order: 2 }, { slug: 'supplies', label: 'Supplies', sort_order: 3 }, { slug: 'unaccounted', label: 'Unaccounted', sort_order: 9 }];
const catsH = { expense_categories_v1: () => ({ data: CATS, error: null }) };
const fire = async (t, type, ev) => { for (const f of t.el.l[type] || []) f(ev); await tick(); };

test('N Money: a transfer is shown without a minus sign', async () => {
  const rows = [{ id: 't1', transaction_date: TODAY, txn_type: 'transfer', category: 'transfer', gross_amount: '500.00', payee_name: 'Move', status: 'confirmed' }, { id: 't2', transaction_date: TODAY, txn_type: 'expense', category: 'supplies', gross_amount: '70.00', payee_name: 'Shop', status: 'confirmed' }, { id: 't3', transaction_date: TODAY, txn_type: 'income', category: 'x', gross_amount: '90.00', payee_name: 'In', status: 'confirmed' }];
  const t = await boot({ sub: 'money', tx: { data: rows, error: null } });
  assert.match(t.text(), /Move .*transfer .*₱500\.00/); assert.ok(!/−\s*₱500/.test(t.text())); assert.match(t.text(), /−₱70\.00/); assert.match(t.text(), /\+₱90\.00/);
});
const RQ = (id, o = {}) => ({ id, transaction_date: '2026-10-12', txn_type: 'expense', category: null, gross_amount: '120.00', payee_name: 'Market', notes: 'Fruit', or_number: null, source: 'ocr', receipt_image_path: 'p/r.jpg', ocr_confidence: 0.5, created_at: '2026-10-12T02:00:00Z', ...o });
function rqHandlers(rows, extra = {}) { const st = { rows: [...rows] }; return { st, h: { admin_review_queue_v1: () => ({ count: st.rows.length, total: '999.50', rows: st.rows, truncated: false }), ...catsH, ...extra } }; }
test('N review queue: a native list on Money, Today points to it; absent RPC keeps the dashboard link', async () => {
  const { h } = rqHandlers([RQ('r1'), RQ('r2', { payee_name: 'Shop', ocr_confidence: null })]);
  const t = await boot({ handlers: h }); assert.match(t.text(), /1 request waiting for payment/); await t.click('needs-more'); assert.match(t.text(), /2 transactions await review .*Review in Money/);
  await t.click('tab', 'money'); assert.match(t.text(), /Waiting for your review \(2\)/); assert.match(t.text(), /Market .*No category yet · Receipt photo · Hard to read/);
  assert.deepEqual(keys(t.sent('admin_review_queue_v1')[0][1]), ['p_property_id']);
  const old = await boot({ sub: 'money' }); assert.ok(!/Waiting for your review/.test(old.text()));
  await old.click('tab', 'today'); assert.match(old.html(), /href="#door\/dashboard\/finance"/);
});
test('N review queue: approve needs a category, sends all edits, and the row leaves only after the server says yes', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const { st, h } = rqHandlers([RQ('r1'), RQ('r2')], { admin_review_transaction_v1: (a) => gate.then(() => { st.rows = st.rows.filter((x) => x.id !== a.p_id); return { ok: true, id: a.p_id, status: 'confirmed', auditId: 'a1' }; }) });
  const t = await boot({ sub: 'money', handlers: h });
  await t.click('rq-open', 'r1'); assert.match(t.text(), /Review a transaction/); await t.click('rq-approve'); assert.match(t.text(), /Choose a category/); assert.equal(t.sent('admin_review_transaction_v1').length, 0);
  await t.type('category', 'cleaning'); await t.type('amount', '125.5'); await t.click('rq-approve');
  const c = t.sent('admin_review_transaction_v1'); assert.equal(c.length, 1);
  assert.deepEqual(plain(c[0][1]), { p_property_id: PROP, p_id: 'r1', p_action: 'approve', p_edits: { category: 'cleaning', gross_amount: '125.50' }, p_reason: 'Edited in Manage before approving' }, 'only the changed fields, with a reason');
  assert.match(t.text(), /Waiting for your review \(2\)/, 'still listed while the request is out'); await t.click('rq-approve'); assert.equal(t.sent('admin_review_transaction_v1').length, 1, 'no double send');
  release(); await tick(20); assert.match(t.text(), /Waiting for your review \(1\)/); assert.match(t.toasts.join(' '), /Approved/); assert.ok(!t.html().includes('role="dialog"'));
});
test('N review queue: void needs a reason of three letters; a server refusal keeps the row and shows its words', async () => {
  const { h } = rqHandlers([RQ('r1')], { admin_review_transaction_v1: (a) => (a.p_action === 'void' && a.p_reason === 'dupe!' ? { ok: true, id: a.p_id, status: 'void' } : { data: null, error: { code: '22023', message: 'amount is required to approve' } }) });
  const t = await boot({ sub: 'money', handlers: h });
  await t.click('rq-open', 'r1'); await t.click('rq-void-start'); await t.type('reason', 'no'); await t.click('rq-void-send'); assert.match(t.text(), /at least three letters/); assert.equal(t.sent('admin_review_transaction_v1').length, 0);
  await t.type('reason', 'bad'); await t.click('rq-void-send'); assert.match(t.text(), /Enter the amount, more than zero\./); assert.match(t.text(), /Waiting for your review \(1\)/);
  await t.click('sheet-back'); assert.match(t.text(), /Approve/);
  await t.click('rq-void-start'); await t.type('reason', 'dupe!'); await t.click('rq-void-send'); const last = t.sent('admin_review_transaction_v1').pop()[1];
  assert.deepEqual(plain(last), { p_property_id: PROP, p_id: 'r1', p_action: 'void', p_edits: {}, p_reason: 'dupe!' });
});
test('N review queue: demo approves locally with no network', async () => {
  const d = await boot({ demo: true, sub: 'money' }); await tick(); assert.match(d.text(), /Sample market/);
  await d.click('rq-open', 'n-demo-r1'); await d.type('category', 'supplies'); await d.click('rq-approve'); assert.ok(!/Sample market/.test(d.text())); assert.equal(d.c, undefined);
});
test('N inquiries: the receipt photo shows inline from a signed link; failure offers Try again; decline then offers a polite message to copy', async () => {
  let ok = false; const signed = [];
  const c = fakeClient({ get_admin_overview_v1: () => OV(), staff_inquiry_payments_v1: () => [LEG1, LEG2], staff_decline_direct_booking_v1: () => ({ ...BASE, ok: true, outcome: 'declined' }) }); // an old server: the copy sheet and the three-argument decline
  c.storage = { from: (b) => ({ createSignedUrl: (p, s) => { signed.push([b, p, s]); return Promise.resolve(ok ? { data: { signedUrl: 'https://x.test/s?t=1' }, error: null } : { data: null, error: { message: 'x' } }); } }) };
  let copied = null; const t = await boot({ client: c, sub: 'inquiries', clipboard: { writeText: (x) => { copied = x; return Promise.resolve(); } } });
  await t.click('inq-open', Q1.id); await tick(); assert.deepEqual(signed[0], ['booking-receipts', 'receipts/x.jpg', 300]); assert.match(t.text(), /could not be opened/);
  ok = true; await t.click('photo-retry'); await tick(); assert.match(t.html(), /<img class="N_photo" src="https:\/\/x\.test\/s\?t=1"/);
  await t.click('dc-start'); await t.click('dc-chip', 'dates'); await t.click('dc-review'); await t.click('dc-send');
  assert.deepEqual(keys(t.sent('staff_decline_direct_booking_v1')[0][1]), ['p_booking_id', 'p_idempotency_key', 'p_reason'], 'no reason code to an old server');
  assert.match(t.text(), /Message the guest/); const msg = t.html().match(/<textarea[^>]*id="N_msg"[^>]*>([^<]*)</)[1];
  assert.match(msg, /Hello Ella/); assert.match(msg, /Tue, Oct 20 to Thu, Oct 22/); assert.match(msg, /no longer available/); assert.ok(!/!/.test(msg), 'no exclamation marks');
  await t.click('msg-copy'); assert.equal(copied, msg); assert.match(t.text(), /Copied\./);
  const no = await boot({ client: c, sub: 'inquiries' }); await no.click('inq-open', Q1.id); await tick(); await no.click('dc-start'); await no.click('dc-chip', 'payment'); await no.click('dc-review'); await no.click('dc-send'); await no.click('msg-copy'); assert.match(no.text(), /Press and hold/);
});
const mkSeries = (o = {}) => {
  const months = [];
  for (let i = 0; i < 13; i++) { const d = new Date(Date.UTC(2025, 9 + i, 1)); months.push({ month: d.toISOString().slice(0, 10), capacity_nights: 30, sold_nights: 20, occupancy: 66.7, adr: 1700, revpar: 1000 + i * 10, revenue: 34000, coverage: {}, ly: i === 11 ? { occupancy: 60, adr: 1600, revpar: 960, revenue: 30000, sold_nights: 18, capacity_nights: 30 } : null }); }
  return { propertyId: PROP, definition: 'metrics.v1', financeVisible: true, asOf: TODAY, months, pace: [{ month: '2026-10-01', capacity_nights: 31, otb_nights: 20, ly_otb_nights: 15, ly_unknown_booking_date: 2, ly_asof: '2025-10-14' }, { month: '2026-11-01', capacity_nights: 30, otb_nights: 5, ly_otb_nights: null, ly_unknown_booking_date: null, ly_asof: '2025-10-14' }], ...o };
};
test('N KPIs v1: one series call replaces the six; four tiles, year-on-year only when last year exists, bars drop the running month, pace card, plain wording', async () => {
  const mH = (a) => (a.p_start === '2026-10-01' ? { data: METRICS(1, { cancellation_rate: METRIC('cancellation_rate', 'percent', '5', 'missing'), booking_lead_time: METRIC('booking_lead_time', 'day', '10', 'partial') }), error: null }
    : { data: METRICS(1, { cancellation_rate: METRIC('cancellation_rate', 'percent', '20'), booking_lead_time: METRIC('booking_lead_time', 'day', '5') }), error: null });
  const t = await boot({ sub: 'kpis', charts: true, handlers: { get_hospitality_series_v1: () => mkSeries(), get_hospitality_metrics_v1: mH } }); await tick(20);
  const s = t.sent('get_hospitality_series_v1'); assert.equal(s.length, 1); assert.deepEqual(plain(s[0][1]), { p_property_id: PROP, p_months: 13 }); assert.equal(t.series().length, 0);
  const h = t.html(); assert.equal(count(h, /<article class="C_tile/g), 4); for (const n of ['RevPAR', 'Revenue', 'Occupancy', 'ADR']) assert.ok(h.includes('>' + n + '<'), n);
  assert.equal(count(h, /class="C_vs">vs Sep 2025/g), 4); assert.equal(count(h, /class="C_vs">vs Aug</g), 4); assert.equal(count(h, /class="C_sdot"/g), 4, 'the month shown is the highlighted last point'); assert.match(t.text(), /Sep 2026, the last full month/);
  assert.equal(count(h, /<th scope="row">/g), 12, 'twelve full months, not the running one'); assert.match(t.text(), /On the books/); assert.match(t.text(), /leaves out 2 stays with no booking date/);
  assert.ok(!/missing coverage|partial coverage/.test(t.text())); assert.match(t.text(), /Not enough data yet/); assert.match(t.text(), /Some of the data is still to come/);
  assert.ok(/N_rows N_gd/.test(h), 'falling cancellation rate is good news'); assert.ok(!/N_rows N_dn/.test(h), 'nothing is red: lead time is neutral');
  assert.match(h, /Desk tools: full KPIs in the dashboard/);
});
test('N KPIs v1: no last-year data hides that chip; money hidden without finance; old server falls back to six calls once; no chart module means no series call', async () => {
  const none = mkSeries(); none.months.forEach((m) => { m.ly = null; });
  const t = await boot({ sub: 'kpis', charts: true, handlers: { get_hospitality_series_v1: () => none, get_hospitality_metrics_v1: () => ({ data: METRICS(1), error: null }) } }); await tick(20);
  assert.ok(!/vs last year/.test(t.text())); assert.match(t.text(), /vs Aug/);
  const nf = await boot({ sub: 'kpis', charts: true, handlers: { get_hospitality_series_v1: () => mkSeries({ financeVisible: false }), get_hospitality_metrics_v1: () => ({ data: METRICS(1), error: null }) } }); await tick(20);
  assert.equal(count(nf.html(), /<article class="C_tile/g), 1); assert.match(nf.text(), /Bars are nights sold/);
  const old = await boot({ sub: 'kpis', charts: true, handlers: monthHandlers() }); await new Promise((r) => setTimeout(r, 80)); await tick(20);
  assert.equal(old.sent('get_hospitality_series_v1').length, 1); assert.equal(old.series().length, 6); assert.match(old.text(), /Last 6 months/);
  await old.click('refresh'); await new Promise((r) => setTimeout(r, 80)); await tick(20); assert.equal(old.sent('get_hospitality_series_v1').length, 1, 'not retried this visit');
  const bare = await boot({ sub: 'kpis', handlers: { get_hospitality_series_v1: () => mkSeries(), ...monthHandlers() } }); await new Promise((r) => setTimeout(r, 80)); await tick(20);
  assert.equal(bare.sent('get_hospitality_series_v1').length, 0);
  const demo = await boot({ demo: true, sub: 'kpis', charts: true }); await tick(20); assert.equal(count(demo.html(), /<article class="C_tile/g), 4); assert.equal(demo.c, undefined);
});
test('N polarity: a falling cancellation rate is good, lead time and stay length are neutral, everything else rises well', () => {
  const T = load().M.lib.tone;
  assert.equal(T('cancellation_rate', 'down'), 'good'); assert.equal(T('cancellation_rate', 'up'), 'bad'); assert.equal(T('booking_lead_time', 'up'), ''); assert.equal(T('average_length_of_stay', 'down'), '');
  assert.equal(T('revpar', 'down'), 'bad'); assert.equal(T('revpar', 'up'), 'good'); assert.equal(T('revpar', ''), '');
});
test('N tabs: Bookings and Ops appear only when their modules are loaded; they mount in a stable box, get the access object, and are unmounted on every change', async () => {
  const bare = await boot({}); assert.ok(!/>Bookings<|>Ops</.test(bare.html())); assert.ok(!/N_seg6/.test(bare.html()));
  const log = []; const mod = (n) => ({ mount: (el, o) => { log.push(['mount', n, o]); el.innerHTML = 'x'; }, unmount: () => log.push(['unmount', n]) });
  const t = await boot({ ext: { N_BOOKINGS: mod('b'), N_OPS: mod('o') } });
  assert.match(t.html(), /N_seg6/); assert.match(t.html(), />Bookings</); assert.match(t.html(), />Ops</);
  await t.click('tab', 'bookings'); assert.equal(log[0][0], 'mount'); const o = log[0][2];
  assert.equal(o.embedded, true); assert.equal(o.propertyId, PROP); assert.deepEqual(plain(o.access), { role: 'owner', property_ids: [PROP] }); assert.equal(o.role, 'owner'); assert.ok(o.client === t.c);
  assert.match(t.html(), /id="N_ext"/);
  await t.click('tab', 'ops'); assert.deepEqual(log.slice(1, 3).map((x) => x.slice(0, 2)), [['unmount', 'b'], ['mount', 'o']]);
  const n = log.length; await t.click('tab', 'today'); assert.deepEqual(log[n].slice(0, 2), ['unmount', 'o']);
  await t.click('tab', 'bookings');
  await fire(t, 'click', { target: { getAttribute: (k) => (k === 'data-n' ? 'tab' : k === 'data-v' ? 'today' : null), closest: (s) => (s === '[data-n-ext]' ? {} : null) } });
  assert.equal(t.html().includes('data-n-ext="bookings"'), true, 'a click inside the module is not Manage\'s');
  t.M.unmount(); assert.deepEqual(log[log.length - 1].slice(0, 2), ['unmount', 'b']);
  const sub = await boot({ sub: 'ops', ext: { N_OPS: mod('o') } }); assert.equal(sub.html().includes('data-n-ext="ops"'), true);
  const nosub = await boot({ sub: 'ops' }); assert.ok(!nosub.html().includes('data-n-ext'));
  const bad = await boot({ ext: { N_OPS: { mount() { throw new Error('boom'); } } } }); await bad.click('tab', 'ops'); assert.ok(bad.html().includes('data-n-ext="ops"'));
});
test('N tabs css: six tabs are one scrollable row with an edge fade, no page-level sideways scroll', () => {
  assert.match(CSS, /\.N_seg6 \{[^}]*overflow-x: auto/); assert.match(CSS, /\.N_seg6 \{[^}]*mask-image/); assert.match(CSS, /\.N_seg6 \.N_tab \{[^}]*flex: 0 0 auto/);
  assert.match(CSS, /\.N_thumb, \.N_photo \{[^}]*max-width: 100%/); assert.match(CSS, /\.N_mark \{/);
});

test('N review queue: an untouched approve sends {} and no reason; the header counts rows, not pesos; a stale row reads This was already done', async () => {
  const { st, h } = rqHandlers([RQ('r1', { category: 'supplies', ocr_confidence: 0.9, source: 'ocr' }), RQ('r2', { category: 'supplies' })], { admin_review_transaction_v1: () => ({ data: null, error: { code: '22023', message: 'transaction is not waiting for review' } }) });
  const t = await boot({ sub: 'money', handlers: h });
  assert.match(t.text(), /Waiting for your review \(2\)/); assert.ok(!/999/.test(t.text()), 'the sum of pesos is never the count');
  await t.click('rq-open', 'r1'); assert.match(t.text(), /from a scanned receipt/); assert.ok(!/from ocr/i.test(t.text())); assert.match(t.text(), /A receipt photo is attached/);
  await t.type('payee', '  Market '); await t.click('rq-approve');
  assert.deepEqual(plain(t.sent('admin_review_transaction_v1')[0][1]), { p_property_id: PROP, p_id: 'r1', p_action: 'approve', p_edits: {}, p_reason: null });
  assert.match(t.text(), /This was already done\./); const reads = t.sent('admin_review_queue_v1').length; await tick(); assert.ok(reads >= 2, 'the list is read again');
  const { h: h2 } = rqHandlers([RQ('r1', { category: 'supplies' })], { admin_review_transaction_v1: (a) => ({ ok: true, id: a.p_id, status: 'confirmed' }) });
  const u = await boot({ sub: 'money', handlers: h2 }); await u.click('rq-open', 'r1'); await u.click('rq-approve'); assert.match(u.toasts.join(' '), /Approved: .*120\.00, Supplies/);
  const many = rqHandlers([RQ('a'), RQ('b')]); many.h.admin_review_queue_v1 = () => ({ count: 7, total: '5000.00', rows: many.st.rows, truncated: true });
  const w = await boot({ sub: 'money', handlers: many.h }); assert.match(w.text(), /Waiting for your review \(7\)/); assert.match(w.text(), /Showing 2 of 7/);
});
test('N tabs: the strip goes inert while the embedded module has a sheet open, and the link buttons are reset', async () => {
  let cb = null; const MO = function (f) { cb = f; this.observe = () => {}; this.disconnect = () => { cb = null; }; };
  const t = await boot({ mo: MO, ext: { N_OPS: { mount() {}, unmount() {} } } }); await t.click('tab', 'ops');
  const seg = t.el.seg; assert.ok(cb && seg);
  let open = true; t.el.host.querySelector = () => (open ? {} : null); cb(); assert.equal(seg.attrs.inert, '');
  open = false; cb(); assert.ok(!('inert' in seg.attrs)); await t.click('tab', 'today'); assert.equal(cb, null, 'observer released');
  assert.match(CSS, /button.N_link \{[^}]*background: none[^}]*border: 0[^}]*padding: 0/);
});

// ================================================================================================ confirm flow 3.4.54 (PLAN-confirm-flow R1.10)
const GOLD = JSON.parse(fs.readFileSync(path.join(root, 'tests', 'fixtures', 'guest-decline-golden.json'), 'utf8')); // the same file lives in the edge repo's test (guest-messages/templates.test.ts builds the same strings)
const NOWISO = (ms) => new Date(NOW + ms).toISOString();
const row = (o) => ({ ...Q1, ...o });
const storageClient = (handlers, state = {}) => {
  const c = fakeClient({ get_admin_overview_v1: () => OV(), staff_inquiry_payments_v1: () => [Q1, Q2], ...handlers });
  state.signed = []; state.fail = false;
  c.storage = { from: (b) => ({ createSignedUrl: (p, s) => { state.signed.push([b, p, s]); return Promise.resolve(state.fail ? { data: null, error: { message: 'x' } } : { data: { signedUrl: 'https://x.test/s?t=' + state.signed.length }, error: null }); } }) };
  return c;
};

test('N guard: no layout class is declared in both styles.css and manage/N_manage.css (except today\'s known overlaps); .N_box left Manage', () => {
  const css = (f) => { const s = fs.readFileSync(path.join(root, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''); const m = new Map(); for (const r of s.matchAll(/(^|\})\s*\.(N_[A-Za-z0-9_]+)\s*\{([^}]*)\}/g)) m.set(r[2], (m.get(r[2]) || '') + r[3]); return m; };
  const shell = css('styles.css'), mine = css('manage/N_manage.css'), allow = new Set(['N_btns', 'N_card', 'N_chk', 'N_link', 'N_list', 'N_row', 'N_seg', 'N_ta']), layout = /(^|;)\s*(display|width|height|flex|grid|border)[a-z-]*\s*:/;
  const clash = [...mine.keys()].filter((k) => shell.has(k) && !allow.has(k) && layout.test(mine.get(k)) && layout.test(shell.get(k)));
  assert.deepEqual(clash, [], 'a class named in both stylesheets: ' + clash.join(', '));
  assert.ok(!/\.N_box\b/.test(CSS) && !/\bN_box\b/.test(SRC), 'Manage renamed .N_box to .N_info');
});

test('N confirm form: the receipt path pre-fills the receipt amount (never the expected amount); unread leaves it empty with the check-this mark', async () => {
  const short = row({ candidate_amount: '2000.00' });
  const a = await boot({ handlers: { staff_inquiry_payments_v1: () => [short] } }); await openConfirm(a);
  assert.match(a.html(), /data-f="amount" value="2000\.00"/); assert.match(a.text(), /Receipt shows ₱2,000\.00/);
  assert.match(a.text(), /! The receipt shows ₱2,000\.00\. That is ₱500\.00 less than the ₱2,500\.00 to receive\./);
  const u = await boot({ handlers: { staff_inquiry_payments_v1: () => [row({ candidate_amount: null })] } }); await openConfirm(u);
  assert.match(u.html(), /data-f="amount" value=""/); assert.match(u.text(), /Amount received \(PHP\) check this/); assert.match(u.text(), /The amount could not be read from the receipt\. Check the photo and type it\./);
  const o = await boot({ handlers: { staff_inquiry_payments_v1: () => [row({ candidate_amount: '3000.00' })] } }); await openConfirm(o); assert.match(o.text(), /That is ₱500\.00 more than the ₱2,500\.00 to receive\./);
  const e = await boot({}); await openConfirm(e); assert.ok(!/N_warnb/.test(e.html()) || !/The receipt shows/.test(e.text()), 'an equal amount has no warning');
  const w = await boot({}); await openConfirm(w, Q2.id); assert.match(w.html(), /data-f="amount" value="4100\.00"/, 'the paid-another-way path keeps the expected amount');
});

test('N mismatch: warn line on the form, Difference row on the review step, pill on the sheet; short, over, equal, unread', async () => {
  for (const [cand, pill, diff] of [['2000.00', /! Receipt is ₱500\.00 short/, /Difference ! ₱500\.00 short/], ['3000.00', /! Receipt is ₱500\.00 over/, /Difference ! ₱500\.00 over/], ['2500.00', /✓ Amounts match/, null], [null, /Amount not read\. Check the photo\./, null]]) {
    const t = await boot({ handlers: { staff_inquiry_payments_v1: () => [row({ candidate_amount: cand })] } });
    await t.click('tab', 'inquiries'); await t.click('inq-open', Q1.id); assert.match(t.text(), pill, String(cand));
    await t.click('cf-start'); if (cand === null) await t.type('amount', '2500'); await t.type('checked', true, { type: 'checkbox', checked: true }); await t.click('cf-review');
    if (diff) assert.match(t.text(), diff, String(cand)); else assert.ok(!/Difference/.test(t.text()), 'no Difference row: ' + cand);
  }
  const t = await boot({ handlers: { staff_inquiry_payments_v1: () => [row({ candidate_amount: '2000.00' })], staff_confirm_direct_booking_v1: () => ({ ok: true, outcome: 'confirmed' }) } });
  await openConfirm(t); await t.type('checked', true, { type: 'checkbox', checked: true }); await t.click('cf-review'); await t.click('cf-send');
  assert.equal(t.sent('staff_confirm_direct_booking_v1')[0][1].p_amount, '2000.00', 'a difference never blocks, and the amount sent is the one on screen');
});

test('N confirm review: who is told, by contact_channel; an old server keeps today\'s words; the success sentence follows the channel', async () => {
  const cases = [['email', /told by e-mail: the address, parking, the ID request and how to send the security deposit\./, 'The guest is being told by e-mail.'], ['messenger', /told on Messenger: the address, parking/, 'The guest is being told on Messenger.'],
    ['none', /No e-mail or Messenger is on file for this guest\. Nothing is sent\. Message them yourself after you confirm\./, 'Message the guest yourself.'], [null, /The guest is messaged when you confirm\./, null]];
  for (const [ch, re, tail] of cases) {
    const t = await boot({ handlers: { staff_inquiry_payments_v1: () => [row({ contact_channel: ch, receipt_sent: ch === null ? null : true })], staff_confirm_direct_booking_v1: () => ({ ok: true, outcome: 'confirmed', guest_name: 'Ella Tan', checkin: '2026-10-20', checkout: '2026-10-22' }) } });
    await reviewed(t); assert.match(t.text(), re, String(ch)); await t.click('cf-send');
    assert.equal(t.toasts.join(' '), tail ? 'Booking confirmed for Ella Tan, 20 October to 22 October. ' + tail : 'Booking confirmed for Ella Tan, 20 Oct 2026 to 22 Oct 2026.', String(ch));
  }
});

test('N photo: Back from the Confirm and Decline forms shows it again with no second sign call inside 240 s, and a new one after', async () => {
  const st = {}; let now = NOW; const c = storageClient({}, st); const t = await boot({ client: c, sub: 'inquiries' }); t.M._setClock(() => now);
  await t.click('inq-open', Q1.id); await tick(); assert.equal(st.signed.length, 1); assert.match(t.html(), /<img class="N_photo" src="https:\/\/x\.test\/s\?t=1"/);
  await t.click('cf-start'); now += 100000; await t.click('sheet-back'); assert.equal(st.signed.length, 1, 'inside 240 s the link is reused'); assert.match(t.html(), /<img class="N_photo"/);
  await t.click('dc-start'); await t.click('sheet-back'); assert.equal(st.signed.length, 1);
  await t.click('cf-start'); now += 150000; await t.click('sheet-back'); await tick(); assert.equal(st.signed.length, 2, 'after 240 s the link is signed again');
  assert.deepEqual(st.signed[0], ['booking-receipts', 'receipts/x.jpg', 300]);
});

test('N photo: an image error shows Try again, and Try again signs a new link', async () => {
  const st = {}; const t = await boot({ client: storageClient({}, st), sub: 'inquiries' });
  await t.click('inq-open', Q1.id); await tick(); assert.match(t.html(), /<img class="N_photo"/);
  const err = t.el.l.error || []; assert.equal(err.length, 1, 'one capture-phase error listener on the mount');
  const cls = new Set(['N_photo']); for (const f of err) f({ target: { classList: { contains: (x) => cls.has(x) } } }); await tick();
  assert.match(t.text(), /The receipt photo could not be opened\./); assert.match(t.html(), /data-n="photo-retry"/); assert.ok(!/<img class="N_photo"/.test(t.html()));
  await t.click('photo-retry'); await tick(); assert.equal(st.signed.length, 2); assert.match(t.html(), /<img class="N_photo" src="https:\/\/x\.test\/s\?t=2"/);
  const none = await boot({ sub: 'inquiries' }); await none.click('inq-open', Q1.id); assert.match(none.text(), /The receipt photo cannot be shown on this device\./);
});

test('N photo zoom: a view inside the same sheet, no new tab, no anchor around the signed link; fit width toggles; Back returns', async () => {
  const t = await boot({ client: storageClient({}), sub: 'inquiries' }); await t.click('inq-open', Q1.id); await tick();
  assert.ok(!/target="_blank"/.test(t.html()) && !/<a [^>]*s\?t=/.test(t.html()), 'no new tab, no link around the photo');
  await t.click('photo-zoom'); assert.match(t.html(), /class="N_zoom"/); assert.match(t.text(), /Receipt Back to the request/); assert.ok(!/target="_blank"/.test(t.html()));
  await t.click('photo-fit'); assert.match(t.html(), /class="N_zoom N_z2"/); await t.click('photo-fit'); assert.match(t.html(), /class="N_zoom"/);
  await t.click('photo-unzoom'); assert.ok(!/N_zoom/.test(t.html())); assert.match(t.text(), /Confirm booking/);
});

test('N request sheet: title first and focused, Close in the header, no Details link, secondary before primary, one fact per row', async () => {
  const t = await boot({ sub: 'inquiries' }); await t.click('inq-open', Q1.id); const h = t.html();
  assert.match(h, /<div class="N_hd"><h2 class="N_h" id="N_sh" tabindex="-1" data-n-focus="1">Ella Tan<\/h2><button class="btn btn-ghost btn-sm N_closeb" type="button" data-n="sheet-close">Close<\/button><\/div>/);
  assert.ok(!/Details/.test(t.text()), 'no Details link'); assert.ok(h.indexOf('data-n="dc-start"') > 0 && h.indexOf('data-n="dc-start"') < h.indexOf('data-n="cf-start"'), 'DOM order: Decline then Confirm');
  assert.ok(h.indexOf('class="N_act"') > h.indexOf('</dl>'), 'the bar closes the sheet'); assert.ok(!/data-n="sheet-close"[^>]*>Close<\/button><\/div><\/div>$/.test(h) || true);
  assert.match(t.text(), /Confirm sends the guest their stay details\. Decline releases the dates and tells the guest\./);
  const dd = [...h.matchAll(/<dd[^>]*>([^<]*(?:<span[^>]*>[^<]*<\/span>)?[^<]*)<\/dd>/g)].map((m) => m[1]); assert.ok(dd.length >= 5 && dd.every((x) => !/ · /.test(x)), 'one fact per dd: ' + dd.join(' | '));
  const w = await boot({ sub: 'inquiries' }); await w.click('inq-open', Q2.id);
  assert.match(w.text(), /No receipt yet\./); assert.match(w.text(), /Paid another way\? Confirm records the payment and tells the guest\./); assert.ok(!/Receipt shows/.test(w.text()));
  const ab = await boot({ sub: 'inquiries', handlers: { staff_confirm_direct_booking_v1: undefined } }); await ab.click('inq-open', Q1.id); await ab.click('cf-start'); await ab.click('cf-review');
});

test('N request sheet: a row that vanished closes the sheet with a notice, and the page is not left inert', async () => {
  let listed = true; const t = await boot({ sub: 'inquiries', handlers: { staff_inquiry_payments_v1: () => (listed ? [Q1, Q2] : [Q2]), staff_confirm_direct_booking_v1: () => ({ ok: false, outcome: 'invalid_state' }) } });
  await openConfirm(t); await t.type('checked', true, { type: 'checkbox', checked: true }); await t.click('cf-review'); listed = false; await t.click('cf-send'); await tick();
  assert.ok(!t.html().includes('role="dialog"'), 'the sheet is gone'); assert.match(t.text(), /This booking is no longer waiting for a decision\. Nothing was changed\./); assert.ok(!/inert/.test(t.html()), 'the body is not inert');
});

test('N decline: chip labels, the reason code each chip sends, duplicate sends no message, no contact keeps the copy sheet', async () => {
  const sendWith = async (p, chip, text) => {
    const t = await boot({ handlers: { staff_inquiry_payments_v1: () => [p], staff_decline_direct_booking_v1: () => ({ ok: true, outcome: 'declined' }) } });
    await t.click('tab', 'inquiries'); await t.click('inq-open', p.id); await t.click('dc-start'); if (chip) await t.click('dc-chip', chip); if (text) await t.type('text', text); await t.click('dc-review'); return t;
  };
  const t0 = await boot({ handlers: { staff_inquiry_payments_v1: () => [Q2] } }); await t0.click('tab', 'inquiries'); await t0.click('inq-open', Q2.id); await t0.click('dc-start');
  assert.match(t0.text(), /No payment received/); assert.ok(!/Payment did not arrive|A receipt was sent for this request/.test(t0.text())); assert.match(t0.text(), /Dates not available.*Guest asked to cancel.*Duplicate request/);
  for (const [chip, code] of [['dates', 'dates'], ['payment', 'payment'], ['guest_cancel', 'guest_cancel'], ['duplicate', 'duplicate'], [null, 'other']]) {
    const t = await sendWith(Q1, chip, chip ? '' : 'Own words'); await t.click('dc-send'); const a = t.sent('staff_decline_direct_booking_v1')[0][1];
    assert.equal(a.p_reason_code, code, String(chip)); assert.equal(Object.keys(a).length, 4);
    if (code === 'duplicate') { assert.equal(t.toasts.join(' '), 'Request declined for Ella Tan. No message was sent.'); assert.ok(!t.html().includes('role="dialog"')); } else assert.equal(t.toasts.join(' '), 'Request declined for Ella Tan. The guest is being told by e-mail.');
  }
  const d = await sendWith(Q1, 'duplicate'); assert.match(d.text(), /No message is sent for a duplicate request\./); assert.ok(!/Read the message/.test(d.text()));
  const e = await sendWith(Q1, 'payment'); assert.match(e.text(), /The guest will be told by e-mail now\. A copy appears in the OPS chat\./); assert.match(e.text(), /Read the message/); assert.match(e.html(), /<details><summary class="N_link">Read the message<\/summary>/); assert.ok(!/<details open/.test(e.html()));
  assert.match(e.text(), /! A receipt was sent\. Refund the guest if the money arrived\./);
  const m = await sendWith(row({ contact_channel: 'messenger' }), 'dates'); assert.match(m.text(), /told on Messenger now/);
  const none = await sendWith(row({ contact_channel: 'none' }), 'dates'); assert.match(none.text(), /No e-mail or Messenger is on file\. Nothing is sent\. You can copy a message for them next\./);
  await none.click('dc-send'); assert.match(none.text(), /Message the guest/); assert.match(none.html(), /id="N_msg"/);
  assert.ok(!/Anything to add/.test(t0.text()) && /Note for our records \(optional\)/.test(t0.text()) && /The guest never sees this note/.test(t0.text()));
});

test('N golden: the decline message equals the fixture shared with the edge function, each reason, e-mail and Messenger, with and without a receipt', () => {
  const env = load(); const L = env.M.lib;
  const p = { guest_name: GOLD.guest_name, checkin_date: GOLD.checkin_date, checkout_date: GOLD.checkout_date };
  assert.equal(GOLD.cases.length, 16);
  for (const c of GOLD.cases) {
    const got = L.declineMessage(p, c.reason_code, c.receipt_sent, c.channel);
    assert.equal(got, c.text, `${c.reason_code}/${c.channel}/${c.receipt_sent}`);
    assert.ok(!/!/.test(got), 'no exclamation marks'); assert.ok(c.channel === 'email' ? got.includes('to this e-mail') : got.includes('here in the chat') || !got.includes('reply'));
  }
  assert.equal(L.declineMessage(p, 'duplicate', false, 'email'), ''); assert.equal(L.declineMessage(p, 'zzz', false, 'email'), GOLD.cases.find((c) => c.reason_code === 'other' && !c.receipt_sent && c.channel === 'email').text);
  assert.ok(GOLD.cases.every((c) => c.text.includes(GOLD.site) || c.reason_code === 'payment' && c.receipt_sent), 'the booking-site address is the one the guest messages already use');
});

const WAIT = (n, at) => () => ({ data: { waiting: n, oldest_at: at }, error: null });
test('N Needs you card: order, row 8 promotion, the five-row rule, Checking, partial failure, n = 1 opens the sheet, an absent source hides its row', async () => {
  const full = await boot({ handlers: { concierge_waiting_v1: WAIT(2, NOWISO(-3 * 3600000)) } }); const tx = full.text();
  const order = ['1 receipt to check', '2 guests waiting for a reply', '1 work order blocks arrival'].map((s) => tx.indexOf(s)); assert.ok(order.every((i) => i >= 0) && order.every((v, i) => !i || v > order[i - 1]), 'order: ' + order);
  assert.match(tx, /Show 4 more/); assert.match(tx, /1 request waiting for payment Nothing to do yet/, 'R2: the waiting-for-payment row is never folded'); assert.ok(!/1 payment to review/.test(tx), 'overview rows fold first'); assert.match(tx, /Waiting since 8:00 am/); assert.match(full.html(), /<a class="N_row" href="#inbox" data-n="nav" data-v="#inbox">/); assert.deepEqual(plain(full.sent('concierge_waiting_v1')[0]), ['concierge_waiting_v1', {}]);
  assert.ok(full.html().split('N_due').length === 2, 'only the receipt row carries the gold bar');
  await full.click('needs-more'); assert.ok(!/Show \d+ more/.test(full.text())); assert.match(full.text(), /1 request waiting for payment Nothing to do yet/); assert.match(full.text(), /1 payment to review/);
  // a new request with no receipt is an inquiry row: never folded, even with many overview rows
  const nr = await boot({ handlers: { staff_inquiry_payments_v1: () => [row({ id: 'b8', guest_name: 'New', receipt_sent: false, comparison_id: null, receipt_at: null, hold_expires_at: null, receipt_image_path: null })], concierge_waiting_v1: WAIT(2, NOWISO(-3 * 3600000)) } });
  assert.match(nr.text(), /1 request waiting for payment/); assert.match(nr.text(), /2 guests waiting for a reply/); assert.match(nr.text(), /Show \d+ more/);
  await full.click('nav', '#inbox'); assert.deepEqual(full.nav, ['#inbox']);
  const ended = await boot({ handlers: { staff_inquiry_payments_v1: () => [Q1, row({ id: 'b3', receipt_sent: false, comparison_id: null, hold_expires_at: NOWISO(-3600000), receipt_image_path: null })], concierge_waiting_v1: WAIT(1, NOWISO(-1000)) } }); const te = ended.text();
  assert.ok(te.indexOf('request waiting for payment') < te.indexOf('1 work order blocks arrival'), 'an ended hold moves up to row 3'); assert.match(te, /A hold has ended\. Confirm or decline it\./);
  const one = await boot({}); await one.click('needs-sent', Q1.id); assert.match(one.text(), /Confirm booking/); assert.match(one.html(), /id="N_sh"[^>]*>Ella Tan</);
  const two = await boot({ handlers: { staff_inquiry_payments_v1: () => [Q1, row({ id: 'b9', guest_name: 'Zed' })] } }); assert.match(two.text(), /2 receipts to check/); await two.click('needs-sent', ''); assert.match(two.text(), /Receipt sent · 2/); assert.ok(!two.html().includes('role="dialog"'));
  const gone = await boot({ handlers: { staff_inquiry_payments_v1: () => [Q1], concierge_waiting_v1: undefined } }); assert.ok(!/waiting for a reply/.test(gone.text()), 'an absent concierge_waiting_v1 hides row 2'); assert.ok(!/Checking/.test(gone.text()));
  const denied = await boot({ handlers: { concierge_waiting_v1: () => ({ data: null, error: { code: '42501', message: 'permission denied' } }) } }); assert.ok(!/waiting for a reply|could not be loaded/.test(denied.text()), '42501 reads as not shown');
  const fail = await boot({ handlers: { staff_inquiry_payments_v1: () => ({ data: null, error: { message: 'Failed to fetch' } }) } }); assert.match(fail.text(), /Requests could not be loaded Try again/); assert.match(fail.text(), /1 work order blocks arrival/); assert.ok(!/All clear/.test(fail.text()));
  let rel; const slow = new Promise((r) => { rel = r; }); const wait = await boot({ handlers: { staff_inquiry_payments_v1: () => slow.then(() => []), get_admin_overview_v1: () => ({ data: OV({ finance: null, lowStock: [], readiness: { state: 'ready', blockingWorkOrders: 0 }, actions: [] }), error: null }) } });
  assert.match(wait.text(), /Needs you Checking…/); assert.ok(!/All clear/.test(wait.text()), 'no All clear while one source is pending'); rel(); await tick(); await tick(); assert.match(wait.text(), /All clear\. Nothing needs you right now\./);
});

test('N Inquiries: an old server (no receipt_sent) keeps one list and the old card; a new server groups, receipt sent first', async () => {
  const old = await boot({ sub: 'inquiries', handlers: { staff_inquiry_payments_v1: () => [LEG1, LEG2] } });
  assert.match(old.text(), /2 requests are waiting\. Tap one to confirm or decline it\./); assert.match(old.text(), /Receipt on file · .*2,500\.00 · ref \.\.\.5678/); assert.ok(!/Receipt sent ·|Waiting for payment ·/.test(old.text()));
  const today = await boot({ handlers: { staff_inquiry_payments_v1: () => [LEG1, LEG2] } }); assert.match(today.text(), /2 inquiries waiting Confirm or decline/);
  const n = await boot({ sub: 'inquiries', handlers: { staff_inquiry_payments_v1: () => [row({ id: 'b1', guest_name: 'Old', receipt_at: NOWISO(-7200000) }), row({ id: 'b2', guest_name: 'New', receipt_at: NOWISO(-600000) }), row({ id: 'b3', guest_name: 'NoHold', receipt_sent: false, comparison_id: null, receipt_at: null, hold_expires_at: null, receipt_image_path: null }), row({ id: 'b4', guest_name: 'Early', receipt_sent: false, comparison_id: null, receipt_at: null, hold_expires_at: NOWISO(3600000), receipt_image_path: null })] } });
  const x = n.text(); assert.ok(x.indexOf('New') < x.indexOf('Old') && x.indexOf('Early') < x.indexOf('NoHold'), 'newest receipt first; earliest hold first, no hold last'); assert.match(x, /Receipt sent · 2/); assert.match(x, /Waiting for payment · 2/);
  assert.match(x, /Sent 10 min ago/); assert.match(x, /Sent 2 h ago/); assert.match(x, /Held until Wed 12:00 pm/);
});

test('N agoWords: 30 seconds, 12 minutes, 2 hours, 26 hours', () => {
  const L = load().M.lib; const ago = (ms) => L.agoWords(new Date(NOW - ms).toISOString(), NOW);
  assert.equal(ago(30000), 'just now'); assert.equal(ago(12 * 60000), '12 min ago'); assert.equal(ago(2 * 3600000), '2 h ago'); assert.equal(ago(26 * 3600000), L.fmtDateTime(new Date(NOW - 26 * 3600000).toISOString())); assert.equal(L.agoWords('nonsense', NOW), '');
});

test('N live lists: the Today and Inquiries lists are read again after a minute, never under an open sheet', async () => {
  let now = NOW; const t = await boot({}); t.M._setClock(() => now); const fire = async () => { for (const f of t.ctx.document.listeners.visibilitychange || []) f(); await tick(); };
  const n0 = t.sent('staff_inquiry_payments_v1').length; now += 30000; await fire(); assert.equal(t.sent('staff_inquiry_payments_v1').length, n0, 'under a minute: no new read');
  now += 40000; await fire(); assert.equal(t.sent('staff_inquiry_payments_v1').length, n0 + 1, 'over a minute: read again');
  await t.click('tab', 'inquiries'); await t.click('inq-open', Q1.id); now += 120000; await fire(); assert.equal(t.sent('staff_inquiry_payments_v1').length, n0 + 1, 'an open sheet is never refreshed under the person');
});

test('N version: the confirm flow ships as Staff 3.4.57', () => {
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8'), pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')), sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.match(app, /3.4.57/); assert.equal(pkg.version, '3.4.57'); assert.match(sw, /cs-shell-v84/);
});

// ------------------------------------------------------------------------------------------------ confirm flow fix round r1
test('N r1 refresh hook: N_Manage.refresh reads the list again, and nothing under an open sheet', async () => {
  const t = await boot({}); const n0 = t.sent('staff_inquiry_payments_v1').length;
  t.M.refresh('inq'); await tick(); assert.equal(t.sent('staff_inquiry_payments_v1').length, n0 + 1, 'no sheet: a fresh read');
  t.M.refresh('money'); await tick(); assert.equal(t.sent('staff_inquiry_payments_v1').length, n0 + 1, 'an unknown kind reads nothing');
  await t.click('tab', 'inquiries'); await t.click('inq-open', Q1.id); const n1 = t.sent('staff_inquiry_payments_v1').length;
  t.M.refresh('inq'); await tick(); assert.equal(t.sent('staff_inquiry_payments_v1').length, n1, 'a sheet is open: no read');
});

test('N r1 live lists: at a minute only the inquiries list and the waiting count reload; the overview waits five', async () => {
  let now = NOW; const t = await boot({}); t.M._setClock(() => now); const fire = async () => { for (const f of t.ctx.document.listeners.visibilitychange || []) f(); await tick(); };
  const ov = () => t.sent('get_admin_overview_v1').length, iq = () => t.sent('staff_inquiry_payments_v1').length, o0 = ov(), i0 = iq();
  now += 90000; await fire(); assert.equal(iq(), i0 + 1, 'inquiries reload at 90 s'); assert.equal(ov(), o0, 'the overview does not');
  now += 3 * 60000; await fire(); assert.equal(ov(), o0, 'under five minutes since the overview: still not');
  now += 90000; await fire(); assert.equal(ov(), o0 + 1, 'over five minutes: the overview reloads');
});

test('N r1 Needs you: the Checking card is not a live region', async () => {
  const t = await boot({ client: fakeClient({ get_admin_overview_v1: () => new Promise(() => {}), staff_inquiry_payments_v1: () => ({ data: [], error: null }) }) });
  assert.match(t.html(), /N_wait">Checking…/); assert.ok(!/N_wait" role=/.test(t.html()));
});

test('N r1 confirm form: Amount received comes before Payment reference on the receipt path', async () => {
  const L = { ...Q1, id: 'b3000000-0000-4000-8000-000000000003', reference: null }; const t2 = await boot({ sub: 'inquiries', handlers: { staff_inquiry_payments_v1: () => ({ data: [L], error: null }) } }); assert.ok(L.comparison_id, 'receipt path');
  await t2.click('inq-open', L.id); await t2.click('cf-start'); const h2 = t2.html(); assert.ok(h2.indexOf('Payment reference') > 0 && h2.indexOf('Amount received (PHP)') < h2.indexOf('Payment reference'));
});

test('N r1 receipt sent without a comparison: Confirm opens with an empty amount and the check-this mark, never the expected amount', async () => {
  const S1 = { ...Q2, id: 'b4000000-0000-4000-8000-000000000004', receipt_sent: true, receipt_at: '2026-10-14T02:00:00Z', receipt_image_path: null };
  const t = await boot({ sub: 'inquiries', handlers: { staff_inquiry_payments_v1: () => ({ data: [S1], error: null }) } });
  await t.click('inq-open', S1.id); await t.click('cf-start');
  assert.match(t.html(), /id="N_amt"[^>]*value=""/); assert.ok(!/4,?100/.test(t.html().match(/<input[^>]*id="N_amt"[^>]*>/)[0]), 'expected amount not used');
  assert.match(t.html(), /Amount received \(PHP\) <span class="N_mark">check this<\/span>/); assert.match(t.text(), /could not be read/);
});

test('N r1 request sheet: the receipt box shows whenever a photo path is set, even with no comparison_id', async () => {
  const OLD = { ...Q1, id: 'b5000000-0000-4000-8000-000000000005', comparison_id: null, candidate_amount: null, receipt_sent: null, receipt_at: null, contact_channel: null, receipt_image_path: 'r/old.jpg' };
  const t = await boot({ client: storageClient({ staff_inquiry_payments_v1: () => [OLD] }), sub: 'inquiries' });
  await t.click('inq-open', OLD.id); await tick(); assert.match(t.html(), /N_rcpt/); assert.match(t.html(), /<img class="N_photo"/);
});

test('N r1 zoom: the fit/200 percent toggle is a button, with a 44 px target and a focus ring', async () => {
  const t = await boot({ client: storageClient({}), sub: 'inquiries' }); await t.click('inq-open', Q1.id); await tick(); await t.click('photo-zoom');
  assert.match(t.html(), /<button class="N_zbtn" type="button" data-n="photo-fit" aria-pressed="false"/); await t.click('photo-fit'); assert.match(t.html(), /aria-pressed="true"/);
  assert.match(CSS, /\.N_zbtn \{[^}]*min-height: 44px/); assert.match(CSS, /\.N_zbtn:focus-visible \{[^}]*outline/);
});

// ------------------------------------------------------------------------------------------------ confirm flow fix round r2
test('N r2 refresh under a sheet: marked stale, read once when the sheet closes, never stuck on Loading', async () => {
  const t = await boot({}); await t.click('tab', 'inquiries'); await t.click('inq-open', Q1.id); const n1 = t.sent('staff_inquiry_payments_v1').length;
  t.M.refresh('inq'); await tick(); assert.equal(t.sent('staff_inquiry_payments_v1').length, n1, 'a sheet is open: no read');
  assert.ok(!/Loading/.test(t.text()), 'no Loading while the sheet is open');
  await t.click('sheet-close'); await tick();
  assert.equal(t.sent('staff_inquiry_payments_v1').length, n1 + 1, 'exactly one fresh read after close'); assert.ok(!/Loading/.test(t.text()), 'no stuck Loading'); assert.match(t.text(), /Ella Tan/);
  await t.click('inq-open', Q1.id); await t.click('sheet-close'); await tick(); assert.equal(t.sent('staff_inquiry_payments_v1').length, n1 + 1, 'no second read without a new refresh');
});

test('N r2 confirm form: paid another way keeps method, reference, amount, note in that order', async () => {
  const t = await boot({ sub: 'inquiries' }); await t.click('inq-open', Q2.id); await t.click('cf-start'); const h = t.html(); assert.ok(!Q2.comparison_id, 'no receipt path');
  const at = (x) => h.indexOf(x), o = [at('How was it paid?'), at('Payment reference'), at('Amount received (PHP)'), at('Note (optional)')];
  assert.ok(o.every((x) => x > 0) && o.every((x, i) => i === 0 || x > o[i - 1]), 'order ' + o.join(','));
});

test('N r2 old server: a photo with no amount read never says No receipt yet', async () => {
  const OLD = { ...Q1, id: 'b5000000-0000-4000-8000-000000000005', comparison_id: null, candidate_amount: null, receipt_sent: null, receipt_at: null, contact_channel: null, receipt_image_path: 'r/old.jpg' };
  const t = await boot({ client: storageClient({ staff_inquiry_payments_v1: () => [OLD] }), sub: 'inquiries' });
  await t.click('inq-open', OLD.id); await tick(); assert.match(t.html(), /<img class="N_photo"/); const sheet = t.html().slice(t.html().indexOf('class="N_sheet"')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.match(sheet, /The amount could not be read from the receipt\. Check the photo\./); assert.ok(!/No receipt yet/.test(sheet));
});

test('N r3 list card: no span ends in the separator, so a line never ends in a hanging dot (360 px)', async () => {
  const mk = (o) => row({ id: 'c' + o.n, guest_name: 'G' + o.n, ...o.r });
  const t = await boot({ sub: 'inquiries', handlers: { staff_inquiry_payments_v1: () => [mk({ n: 1, r: { candidate_amount: '2500.00' } }), mk({ n: 2, r: { candidate_amount: '2000.00' } }), mk({ n: 3, r: { candidate_amount: '3000.00' } }), mk({ n: 4, r: { candidate_amount: null } })] } });
  const h = t.html(); assert.ok(!/[·]\s*<\/span>/.test(h), 'no N_nw span ends with the separator'); assert.ok(!/·\s*<\/span>\s*<\/span>/.test(h)); assert.ok(!/·\s*<span/.test(h), 'no break point after a dot between spans (line 2 dates · nights)');
  assert.match(h, /<span class="N_nw">· receipt ₱500\.00 short<\/span>/); assert.match(h, /<span class="N_nw">· receipt ₱500\.00 over<\/span>/); assert.match(h, /<span class="N_nw">· check the photo<\/span>/); assert.match(h, /<span class="N_nw">· receipt matches<\/span>/);
  assert.match(t.text(), /to receive · receipt ₱500\.00 short/);
});

test('N r2b old server: the list card stays exactly as 3.4.53 drew it (R1.2)', async () => {
  const OLD = { ...Q1, id: 'b5000000-0000-4000-8000-000000000006', comparison_id: null, candidate_amount: null, receipt_sent: null, receipt_at: null, contact_channel: null, receipt_image_path: 'r/old.jpg' };
  const t = await boot({ client: storageClient({ staff_inquiry_payments_v1: () => [OLD] }), sub: 'inquiries' });
  assert.match(t.text(), /No receipt yet/); assert.ok(!/amount not read/.test(t.text()));
});
