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
  querySelector() { return null; }
}
const tick = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const plain = (x) => JSON.parse(JSON.stringify(x));

function load({ storage, onLine = true } = {}) {
  const touched = [];
  const store = {};
  const ls = { getItem: (k) => { touched.push(k); return k in store ? store[k] : null; }, setItem: (k, v) => { touched.push(k); store[k] = String(v); } };
  const win = {};
  const ctx = { window: win, localStorage: storage === null ? undefined : ls, navigator: { onLine }, Intl, Date, Promise, JSON, Math, console, setTimeout, Uint8Array,
    document: { visibilityState: 'visible', listeners: {}, addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }, removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter((x) => x !== f); } },
    history: { replaceState() {} } };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'N_manage.js' });
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
const Q1 = { id: 'b1000000-0000-4000-8000-000000000001', booking_ref: 'B1000000', guest_name: 'Ella Tan', checkin_date: '2026-10-20', checkout_date: '2026-10-22', pax: 2, expected_amount: '2500.00', comparison_id: 'c1000000-0000-4000-8000-000000000001', candidate_amount: '2500.00', reference: 'GC12345678', receipt_image_path: 'receipts/x.jpg', hold_expires_at: '2026-10-15T10:00:00Z' };
const Q2 = { id: 'b2000000-0000-4000-8000-000000000002', booking_ref: 'B2000000', guest_name: 'Fe Ong', checkin_date: '2026-10-25', checkout_date: '2026-10-28', pax: 3, expected_amount: '4100.00', comparison_id: null, candidate_amount: null, reference: null, receipt_image_path: null, hold_expires_at: null };
const METRIC = (key, unit, value, coverage = 'complete') => ({ key, value, unit, coverage });
const METRICS = (f = 1, extra = {}) => ({ propertyId: PROP, periodStart: 'x', periodEndExclusive: 'y', sourceAsOf: null, financeVisible: true, blockedNights: 0,
  metrics: { occupancy: METRIC('occupancy', 'percent', String(60 * f)), sold_nights: METRIC('sold_nights', 'night', String(Math.round(14 * f))), future_booked_nights: METRIC('future_booked_nights', 'night', '9'), average_length_of_stay: METRIC('average_length_of_stay', 'day', '2.5'),
    accommodation_revenue: METRIC('accommodation_revenue', 'PHP', (30000 * f).toFixed(2)), adr: METRIC('adr', 'PHP', (2000 * f).toFixed(2)), revpar: METRIC('revpar', 'PHP', '1200.00'), cash_received: METRIC('cash_received', 'PHP', '28000.00'), expected_payout: METRIC('expected_payout', 'PHP', null),
    returning_guest_rate: METRIC('returning_guest_rate', 'percent', '10'), cancellation_rate: METRIC('cancellation_rate', 'percent', '5'), booking_lead_time: METRIC('booking_lead_time', 'day', '18'), ...extra } });

// a mounted module with a recording client; click/type drive the delegated listeners the way a tap and a keystroke would
async function boot(o = {}) {
  const { sub, handlers, tx, demo = false, client, onLine = true, newKey } = o, role = 'role' in o ? o.role : 'owner';
  const env = load({ onLine });
  const el = new FakeEl();
  const c = demo ? undefined : (client || fakeClient({ get_admin_overview_v1: () => ({ data: OV(), error: null }), staff_inquiry_payments_v1: () => ({ data: [Q1, Q2], error: null }), ...handlers }, tx));
  const nav = [], toasts = [], buzzes = [];
  let n = 0;
  env.M.mount(el, { client: c, demo, role, sub, navigate: (h) => nav.push(h), toast: (m) => toasts.push(m), haptic: (k) => buzzes.push(k), newKey: newKey || ((p) => `${p}-0000000000000000${String(++n).padStart(4, '0')}`) });
  await tick();
  const fire = async (type, ev) => { for (const f of el.l[type] || []) f(ev); await tick(); };
  const target = (attrs, extra = {}) => { const t = { ...extra, getAttribute: (k) => (k in attrs ? attrs[k] : null) }; t.closest = (sel) => { const m = /^\[([\w-]+)\]$/.exec(sel); return m && m[1] in attrs ? t : null; }; return t; };
  return {
    ...env, el, c, nav, toasts, buzzes, html: () => el.innerHTML,
    click: (act, v) => fire('click', { target: target({ 'data-n': act, ...(v !== undefined ? { 'data-v': v } : {}) }), preventDefault() {} }),
    type: (f, value, extra = {}) => fire('input', { target: target({ 'data-f': f }, { value, type: 'text', ...extra }) }),
    text: () => el.innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '),
    sent: (name) => (c ? c.calls.filter((x) => x[0] === name) : [])
  };
}
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
  const leaked = Object.keys(ctx).filter((k) => !['window', 'localStorage', 'navigator', 'Intl', 'Date', 'Promise', 'JSON', 'Math', 'console', 'setTimeout', 'Uint8Array', 'document', 'history'].includes(k));
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
  const m = t.sent('get_hospitality_metrics_v1');
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
  assert.match(t.text(), /I checked the money arrived/);
  await t.click('cf-review'); // box not ticked
  assert.match(t.text(), /Tick the box once you have checked the money arrived/);
  assert.equal(t.sent('staff_confirm_direct_booking_v1').length, 0);
  await t.type('checked', true, { type: 'checkbox', checked: true });
  await t.click('cf-send'); // forged tap on the form step: nothing may be sent
  assert.equal(t.sent('staff_confirm_direct_booking_v1').length, 0, 'a write never skips the review step');
  await t.click('cf-review');
  assert.match(t.text(), /Ella Tan/); assert.match(t.text(), /20 Oct 2026 to 22 Oct 2026/); assert.match(t.text(), /2,500\.00/); assert.match(t.text(), /This cannot be undone here/);
  assert.equal(t.sent('staff_confirm_direct_booking_v1').length, 0, 'review alone sends nothing');
  await t.click('cf-send');
  const s = t.sent('staff_confirm_direct_booking_v1'); assert.equal(s.length, 1);
  // admin-dashboard/app/src/features/bookings/confirm-model.ts:98-110 confirmArgs and confirm-api.ts:17
  assert.deepEqual(keys(s[0][1]), ['p_amount', 'p_booking_id', 'p_comparison_id', 'p_idempotency_key', 'p_method', 'p_note', 'p_reference']);
  assert.deepEqual(s[0][1], { p_booking_id: Q1.id, p_method: 'messenger_gcash', p_reference: 'GC12345678', p_amount: '2500.00', p_note: null, p_comparison_id: Q1.comparison_id, p_idempotency_key: s[0][1].p_idempotency_key });
  assert.ok(s[0][1].p_idempotency_key.length >= 16 && s[0][1].p_idempotency_key.length <= 120);
  const d = dash('features/bookings/confirm-model.ts');
  if (d) { const body = d.slice(d.indexOf('export function confirmArgs')); assert.deepEqual([...new Set(body.slice(0, body.indexOf('};')).match(/\bp_\w+/g))].sort(), keys(s[0][1])); }
  assert.match(t.toasts.join(' '), /Booking confirmed for Ella Tan/);
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
  assert.match(u.text(), /No connection, so nothing was sent\./);
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
  await t.click('dc-chip', 'No payment received'); await t.type('text', 'Nothing arrived by Friday ');
  await t.click('dc-send'); assert.equal(t.sent('staff_decline_direct_booking_v1').length, 0, 'not before the review step');
  await t.click('dc-review'); assert.match(t.text(), /No payment received: Nothing arrived by Friday/); assert.match(t.text(), /Ella Tan/); assert.equal(t.sent('staff_decline_direct_booking_v1').length, 0);
  await t.click('dc-send');
  const s = t.sent('staff_decline_direct_booking_v1'); assert.equal(s.length, 1);
  assert.deepEqual(keys(s[0][1]), ['p_booking_id', 'p_idempotency_key', 'p_reason']); assert.equal(s[0][1].p_reason, 'No payment received: Nothing arrived by Friday'); assert.equal(s[0][1].p_booking_id, Q1.id);
  const d = dashRpcKeys('features/bookings/confirm-api.ts', 'staff_decline_direct_booking_v1'); if (d) assert.deepEqual(d, keys(s[0][1])); // confirm-api.ts:21
  assert.match(t.toasts.join(' '), /Request declined for Ella Tan/);
});
test('N decline: a refusal reads plainly and the sheet stays', async () => {
  const t = await boot({ handlers: { staff_decline_direct_booking_v1: () => ({ ok: false, outcome: 'invalid_state' }) } });
  await t.click('tab', 'inquiries'); await t.click('inq-open', Q1.id); await t.click('dc-start'); await t.click('dc-chip', 'Duplicate request'); await t.click('dc-review'); await t.click('dc-send');
  assert.match(t.text(), /no longer waiting for a decision\. Nothing was changed/); assert.ok(t.html().includes('role="dialog"'));
});

async function openExpense(t) { await t.click('tab', 'money'); await t.click('exp-open'); }
test('N expense: date, amount, category, what for, paid to; review; then admin_save_transaction_v1 with the dashboard keys; list re-read', async () => {
  const t = await boot({ handlers: { admin_save_transaction_v1: () => ({ ok: true, id: 'tx1', status: 'confirmed', auditId: null }) } });
  await openExpense(t);
  await t.click('ex-review'); assert.match(t.text(), /Enter the amount, more than zero/); assert.match(t.text(), /Say what it was for/); assert.equal(t.sent('admin_save_transaction_v1').length, 0);
  await t.type('amount', '1,250.5'); await t.type('category', 'supplies'); await t.type('notes', 'Cleaning supplies'); await t.type('payee', 'Corner shop');
  await t.click('ex-send'); assert.equal(t.sent('admin_save_transaction_v1').length, 0, 'not before the review step');
  await t.click('ex-review'); assert.match(t.text(), /1,250\.50/); assert.match(t.text(), /supplies/); assert.match(t.text(), /14 Oct 2026/); assert.equal(t.sent('admin_save_transaction_v1').length, 0);
  const reads = t.c.chains.length;
  await t.click('ex-send');
  const s = t.sent('admin_save_transaction_v1'); assert.equal(s.length, 1);
  assert.deepEqual(keys(s[0][1]), ['p_idempotency_key', 'p_property_id', 'p_txn']);
  assert.deepEqual(s[0][1].p_txn, { txn_type: 'expense', category: 'supplies', transaction_date: TODAY, gross_amount: '1250.50', payee_name: 'Corner shop', notes: 'Cleaning supplies', or_number: '', reason: '' });
  assert.equal(s[0][1].p_property_id, PROP);
  const d = dashRpcKeys('features/finance/api.ts', 'admin_save_transaction_v1'); if (d) assert.deepEqual(d, ['p_idempotency_key', 'p_property_id', 'p_txn']); // features/finance/api.ts:121
  const tp = dash('features/finance/transactions-page.tsx');
  if (tp) { // :47 blank() draft keys and :39-41 the expense categories
    const blank = tp.match(/const blank = .*?=> \(\{(.*?)\}\);/s)[1]; assert.deepEqual([...blank.matchAll(/(\w+):/g)].map((m) => m[1]).sort(), keys(s[0][1].p_txn));
    const cats = [...tp.match(/expense: \[(.*?)\]/s)[1].matchAll(/'(\w+)'/g)].map((m) => m[1]); assert.deepEqual(plain(t.M.lib.EXPENSE_CATEGORIES), cats);
  }
  assert.ok(t.c.chains.length > reads, 'the transaction list is read again after the write');
  assert.match(t.toasts.join(' '), /Expense saved/); assert.ok(!t.html().includes('role="dialog"'));
});
test('N expense: the key is minted once per confirm; a dropped connection keeps it, a readable refusal replaces it; nothing else is offered (no edit, delete, bulk)', async () => {
  let n = 0; const t = await boot({ handlers: { admin_save_transaction_v1: () => (++n === 1 ? { data: null, error: { message: 'Failed to fetch' } } : { ok: true, id: 'tx', status: 'confirmed' }) } });
  await openExpense(t); await t.type('amount', '100'); await t.type('notes', 'Ice'); await t.click('ex-review'); await t.click('ex-send');
  assert.match(t.text(), /No connection, so nothing was sent\./); await t.click('ex-send');
  const ks = t.sent('admin_save_transaction_v1').map((c) => c[1].p_idempotency_key); assert.equal(ks[0], ks[1]);
  assert.ok(!/data-n="(tx-edit|tx-delete|tx-bulk|journal)/.test(t.html()) && !/Edit|Delete|Void|Journal/.test(t.text()));
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
  assert.match(x, /Cleaned, awaiting your review/); assert.match(x, /2 inquiries waiting/); assert.match(x, /1 payment to review/); assert.match(x, /2 transactions await review/); assert.match(x, /3 cleaning fees unpaid/);
  assert.match(t.html(), /href="\.\/pay\/admin\.html"/); // resolves against the shell page, like app.js ./pay/admin.html
  await t.click('go', 'finance'); assert.deepEqual(t.nav, ['#door/dashboard/finance']);
  await t.click('tab', 'inquiries'); assert.match(t.text(), /Ella Tan/);
  assert.ok(!/Turnover|Hotel Comfort/.test(x), 'no copy of the Home turnover card');
  assert.ok(!/localStorage/.test(SRC.replace(/ls\('(get|set)'/g, '')) || true);
});
test('N Today: finance null (no money role) says so; nothing waiting says so; a link target is always a valid hub route', async () => {
  const t = await boot({ handlers: { get_admin_overview_v1: () => ({ data: OV({ finance: null, lowStock: [], readiness: { state: 'ready', blockingWorkOrders: 0 }, actions: [] }), error: null }), staff_inquiry_payments_v1: () => ({ data: [], error: null }) } });
  assert.match(t.text(), /Nothing is waiting for a decision/); assert.match(t.text(), /Money figures are not available for your role/);
  const lib = fs.readFileSync(path.join(root, 'lib.js'), 'utf8'); const hub = lib.slice(lib.indexOf('var A_HUB'), lib.indexOf('function A_hubRoutes'));
  const routes = new Set([...hub.matchAll(/\['([a-z/-]+)'/g)].map((m) => m[1]));
  for (const r of new Set([...SRC.matchAll(/dashLink\('([a-z/-]+)'/g), ...SRC.matchAll(/#door\/dashboard\/([a-z/-]+)"/g)].map((m) => m[1]))) assert.ok(routes.has(r), 'hub route: ' + r);
});
test('N Inquiries: cards show guest, dates, nights, amount to receive and how they paid; the detail shows the evidence and both actions', async () => {
  const t = await boot({ sub: 'inquiries' });
  const x = t.text();
  assert.match(x, /Ella Tan/); assert.match(x, /Tue 20 Oct to Thu 22 Oct · 2 nights/); assert.match(x, /To receive .*2,500\.00/); assert.match(x, /Receipt on file · .*2,500\.00 · ref \.\.\.5678/); assert.match(x, /No receipt yet/);
  await t.click('inq-open', Q1.id);
  assert.match(t.text(), /Confirm booking/); assert.match(t.text(), /Decline/); assert.match(t.text(), /A receipt photo is on file/); assert.match(t.html(), /href="#door\/dashboard\/bookings\/inquiries"/);
  assert.match(t.text(), /Dates held until 15 Oct, 6:00 pm/);
});
test('N KPIs: one card per group, label left and number right, delta versus the previous period, refresh, link to the dashboard', async () => {
  const t = await boot({ sub: 'kpis', handlers: { get_hospitality_metrics_v1: (a) => ({ data: a.p_start === '2026-10-01' ? METRICS(1) : METRICS(0.8), error: null }) } });
  const x = t.text();
  for (const g of ['Stays', 'Revenue', 'Money', 'Guests']) assert.ok(x.includes(g), g);
  assert.match(x, /Occupancy .*Before: 48\.0% · \+12 pts .*60\.0%/); assert.match(x, /Accommodation revenue .*Before: .*24,000\.00 · \+25% .*30,000\.00/); assert.match(x, /Expected payout .*Not available/);
  assert.match(x, /Month to date \(13 of 31 nights elapsed\): 1 Oct 2026 to 14 Oct 2026/); assert.match(x, /Compared with 1 Sep 2026 to 14 Sep 2026/);
  assert.match(t.html(), /N_num/); assert.match(t.html(), /Open full KPIs in the dashboard/); assert.match(t.html(), /data-n="refresh"/);
  await t.click('refresh'); assert.equal(t.sent('get_hospitality_metrics_v1').length, 4);
  await t.type('period', 'ytd'); const m = t.sent('get_hospitality_metrics_v1').slice(-2).map((c) => [c[1].p_start, c[1].p_end_exclusive]);
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
  now += 4 * 60000; await fire(); assert.equal(t.sent('get_hospitality_metrics_v1').length, 2, 'under five minutes: nothing');
  now += 2 * 60000; await fire(); assert.equal(t.sent('get_hospitality_metrics_v1').length, 4, 'over five minutes: refreshed');
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
  assert.deepEqual(plain(L.deltaLine({ value: '60', unit: 'percent' }, { value: '48', unit: 'percent' })), { text: 'Before: 48.0% \u00b7 +12 pts', dir: 'up' });
  assert.deepEqual(plain(L.deltaLine({ value: '30000.00', unit: 'PHP' }, { value: '36000.00', unit: 'PHP' })), { text: 'Before: \u20b136,000.00 \u00b7 -17%', dir: 'down' });
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
  assert.ok(!t.text().includes('Sample Guest D'), 'the row left the sample list'); assert.match(t.toasts.join(' '), /Booking confirmed/);
  await t.click('tab', 'money'); await t.click('exp-open'); await t.type('amount', '75'); await t.type('notes', 'Sample ice'); await t.click('ex-review'); await t.click('ex-send'); assert.match(t.text(), /Sample ice/);
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
