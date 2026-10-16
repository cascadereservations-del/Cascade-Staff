// Lane L6: manage/N_ops.js (work orders + cleaning readiness). Frozen clock 2026-10-14T03:00:00Z. vm sandbox, fake DOM, fake Supabase client that records every call.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(root, 'manage', 'N_ops.js'), 'utf8');
const CSS = fs.readFileSync(path.join(root, 'manage', 'N_ops.css'), 'utf8');
const DASH = path.join(root, '..', 'admin-dashboard', 'app', 'src', 'features', 'operations', 'api.ts');
const NOW = Date.parse('2026-10-14T03:00:00Z');
const PROP = '6ae230f4-c189-4547-84b1-cb6e0b2cc9bd';
const hoursAgo = (h) => new Date(NOW - h * 3600000).toISOString();
const tick = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const plain = (x) => JSON.parse(JSON.stringify(x));

class FakeEl {
  constructor() { this.html = ''; this.l = {}; }
  set innerHTML(v) { this.html = String(v); }
  get innerHTML() { return this.html; }
  addEventListener(t, f) { (this.l[t] ||= []).push(f); }
  removeEventListener(t, f) { this.l[t] = (this.l[t] || []).filter((x) => x !== f); }
  querySelector() { return null; }
}
function load({ onLine = true } = {}) {
  const win = {};
  const ctx = { window: win, navigator: { onLine }, Intl, Date, Promise, JSON, Math, console, setTimeout, clearTimeout, Uint8Array, document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} } };
  vm.createContext(ctx); vm.runInContext(SRC, ctx, { filename: 'N_ops.js' });
  win.N_OPS._setClock(() => NOW);
  return { M: win.N_OPS, ctx };
}
const WO = (o) => ({ id: 'w1', title: 'Tap drips', description: 'Area: Bathroom\n\nSlow drip', priority: 'normal', blocks_arrival: false, status: 'open', created_at: hoursAgo(50), updated_at: hoursAgo(50), version: 2, resolution: null, resolved_at: null, ...o });
const errChain = (error) => () => { const ch = new Proxy({}, { get: (_, k) => (k === 'then' ? (r) => Promise.resolve({ data: null, error }).then(r) : () => ch) }); return ch; };
function fakeClient({ rows = [], rpcs = {}, tables = {} } = {}) {
  const calls = [], chains = [];
  return {
    calls, chains,
    rpc(name, args) {
      calls.push([name, plain(args || {})]); const h = rpcs[name];
      if (!h) return Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function ' + name } });
      return Promise.resolve(h(args)).then((r) => (r && 'error' in r ? r : { data: r, error: null }));
    },
    from(table) {
      const rec = [['from', table]]; chains.push(rec);
      const data = table === 'work_orders' ? rows : (tables[table] ?? []);
      const ch = new Proxy({}, { get: (_, k) => { if (k === 'then') return (res, rej) => Promise.resolve({ data, error: null }).then(res, rej); return (...a) => { rec.push([k, ...a]); return ch; }; } });
      return ch;
    }
  };
}
async function boot({ access = { role: 'admin', property_ids: [PROP] }, sub, demo, client, ...c } = {}) {
  const env = load(); const el = new FakeEl(); const cl = demo ? undefined : (client !== undefined ? client : fakeClient(c));
  const nav = [], toasts = []; let n = 0;
  env.M.mount(el, { client: cl, access, sub, demo, navigate: (h) => nav.push(h), toast: (m) => toasts.push(m), newKey: (p) => `${p}-0000000000000000${String(++n).padStart(4, '0')}` });
  await tick();
  const fire = async (type, ev) => { for (const f of el.l[type] || []) f(ev); await tick(); };
  const target = (attrs, extra = {}) => { const t = { ...extra, getAttribute: (k) => (k in attrs ? attrs[k] : null) }; t.closest = (sel) => { const m = /^\[([\w-]+)\]$/.exec(sel); return m && m[1] in attrs ? t : null; }; return t; };
  return { ...env, el, client: cl, nav, toasts, html: () => el.innerHTML, text: () => el.innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '),
    click: (a, v) => fire('click', { target: target({ 'data-o': a, ...(v !== undefined ? { 'data-v': v } : {}) }), preventDefault() {} }),
    type: (f, value, extra = {}) => fire('input', { target: target({ 'data-f': f }, { value, type: 'text', ...extra }) }),
    sent: () => (cl ? cl.calls.filter((x) => x[0] === 'save_work_order_v1') : []) };
}

test('parse: script and stylesheet are well formed, only window.N_OPS leaks, no storage, tokens defined, no hard-coded colours', () => {
  assert.doesNotThrow(() => new vm.Script(SRC));
  assert.equal((CSS.match(/\{/g) || []).length, (CSS.match(/\}/g) || []).length);
  assert.deepEqual(Object.keys(load().ctx.window), ['N_OPS']);
  assert.ok(!/localStorage|sessionStorage|document\.cookie/.test(SRC));
  const tokens = fs.readFileSync(path.join(root, 'tokens.css'), 'utf8') + fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  for (const v of new Set([...CSS.matchAll(/var\(--([\w-]+)/g)].map((m) => m[1]))) assert.ok(tokens.includes('--' + v + ':'), 'undefined css variable --' + v);
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(CSS), 'no hard-coded colours');
});
test('copy: no exclamation marks in any string literal', () => {
  const strings = [...SRC.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)].map((m) => m[1]);
  assert.deepEqual(strings.filter((s) => s.includes('!')), []);
});
test('role gate: read roles mount, an unknown role goes home with no call', async () => {
  for (const role of ['owner', 'admin', 'maintenance', 'cleaner']) { const t = await boot({ access: { role } }); assert.deepEqual(t.nav, [], role); assert.ok(t.html().includes('role="tablist"')); }
  for (const access of [null, {}, { role: 'guest' }]) { const t = await boot({ access }); assert.deepEqual(t.nav, ['#home']); assert.equal(t.html(), ''); assert.equal(t.client.calls.length + t.client.chains.length, 0); }
  assert.equal(load().M.lib.canWrite({ role: 'finance' }), false);
  assert.equal(load().M.lib.canWrite({ role: 'maintenance' }), true);
});
test('read shape: work_orders read mirrors the dashboard query under the property id', async () => {
  const t = await boot({ rows: [WO()] });
  const rec = t.client.chains[0];
  assert.deepEqual(rec[0], ['from', 'work_orders']); assert.deepEqual(rec.find((r) => r[0] === 'eq'), ['eq', 'property_id', PROP]);
  assert.deepEqual(plain(rec.find((r) => r[0] === 'order')), ['order', 'blocks_arrival', { ascending: false }]);
  const d = fs.existsSync(DASH) ? fs.readFileSync(DASH, 'utf8') : null;
  if (d) { assert.match(d, /from\('work_orders'\)\.select\('\*'\)\.eq\('property_id', propertyId\)/); assert.match(d, /p_property_id: propertyId, p_order: order, p_idempotency_key: key/); }
});
test('list: open orders sorted blocking, then priority, then oldest; age shown; done hidden under Open', async () => {
  const rows = [WO({ id: 'a', title: 'Low old', priority: 'low', created_at: hoursAgo(400) }), WO({ id: 'b', title: 'Urgent new', priority: 'urgent', created_at: hoursAgo(2) }),
    WO({ id: 'c', title: 'Blocker', priority: 'low', blocks_arrival: true, created_at: hoursAgo(10) }), WO({ id: 'd', title: 'Finished', status: 'resolved', resolution: 'ok', resolved_at: hoursAgo(1) })];
  const t = await boot({ rows });
  const order = ['Blocker', 'Urgent new', 'Low old'].map((s) => t.html().indexOf(s));
  assert.ok(order.every((i) => i > 0) && order[0] < order[1] && order[1] < order[2], String(order));
  assert.ok(!t.text().includes('Finished'));
  assert.match(t.text(), /Open 2 hours/); assert.match(t.text(), /Open 16 days/); assert.match(t.text(), /Blocks arrival/);
  await t.click('filter', 'done'); assert.match(t.text(), /Finished/); assert.ok(!t.text().includes('Blocker'));
});
test('escaping: titles and notes never become markup', async () => {
  const t = await boot({ rows: [WO({ title: '<img src=x onerror=1>', description: '<script>x</script>' })] });
  assert.ok(!t.html().includes('<img src=x') && !t.html().includes('<script>'));
  await t.click('open', 'w1'); assert.ok(!t.html().includes('<script>'));
});
test('create: validates, then one call with the dashboard keys; area rides in the description; no photo control', async () => {
  const t = await boot({ rpcs: { save_work_order_v1: () => ({ ok: true, id: 'n1', version: 1, status: 'open' }) } });
  await t.click('new'); assert.match(t.text(), /Priority/); assert.ok(!/type="file"|photo/i.test(t.html()));
  await t.click('new-send'); assert.match(t.text(), /at least 3 letters/); assert.equal(t.sent().length, 0);
  await t.type('title', 'Fan rattles'); await t.type('area', 'Bedroom'); await t.click('prio', 'high'); await t.type('note', 'Loud at night'); await t.type('blocks', true, { type: 'checkbox', checked: true });
  await t.click('new-send');
  const s = t.sent(); assert.equal(s.length, 1);
  assert.deepEqual(Object.keys(s[0][1]).sort(), ['p_idempotency_key', 'p_order', 'p_property_id']);
  assert.equal(s[0][1].p_property_id, PROP); assert.ok(s[0][1].p_idempotency_key.length >= 16 && s[0][1].p_idempotency_key.length <= 160);
  assert.deepEqual(s[0][1].p_order, { source_kind: 'manual', title: 'Fan rattles', description: 'Area: Bedroom\n\nLoud at night', priority: 'high', blocks_arrival: true });
  assert.ok(!t.html().includes('role="dialog"')); assert.match(t.text(), /Work order saved: Fan rattles/); assert.equal(t.toasts.length, 1);
});
test('create: repeated taps while sending send once', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const t = await boot({ rpcs: { save_work_order_v1: () => gate.then(() => ({ ok: true, id: 'n1', version: 1, status: 'open' })) } });
  await t.click('new'); await t.type('title', 'Door sticks'); await t.click('new-send'); await t.click('new-send'); await t.click('new-send');
  assert.equal(t.sent().length, 1); release(); await tick(); assert.equal(t.sent().length, 1);
});
test('mark done: needs a note, sends id + expected_version + resolved + resolution', async () => {
  const t = await boot({ rows: [WO()], rpcs: { save_work_order_v1: () => ({ ok: true, id: 'w1', version: 3, status: 'resolved' }) } });
  await t.click('open', 'w1'); assert.match(t.text(), /Slow drip/); await t.click('done-start');
  await t.click('done-send'); assert.match(t.text(), /Write what was done/); assert.equal(t.sent().length, 0);
  await t.type('resolution', 'New washer fitted'); await t.click('done-send');
  assert.deepEqual(t.sent()[0][1].p_order, { id: 'w1', expected_version: 2, status: 'resolved', resolution: 'New washer fitted' });
  assert.match(t.text(), /Marked done: Tap drips/);
});
test('reopen: a done order reopens with status open and its version', async () => {
  const t = await boot({ rows: [WO({ status: 'resolved', resolution: 'ok', version: 4 })], rpcs: { save_work_order_v1: () => ({ ok: true, id: 'w1', version: 5, status: 'open' }) } });
  await t.click('filter', 'done'); await t.click('open', 'w1'); assert.match(t.text(), /Reopen/); await t.click('reopen');
  assert.deepEqual(t.sent()[0][1].p_order, { id: 'w1', expected_version: 4, status: 'open' });
});
test('write gate: a reader sees no create, done or reopen controls and forged taps send nothing', async () => {
  const t = await boot({ access: { role: 'cleaner', property_ids: [PROP] }, rows: [WO()] });
  assert.ok(!t.html().includes('data-o="new"')); await t.click('open', 'w1'); assert.ok(!t.html().includes('done-start'));
  await t.click('new'); await t.click('done-start'); await t.click('done-send'); await t.click('reopen'); assert.equal(t.sent().length, 0);
});
test('errors: stale version refreshes with a plain sentence; dropped connection keeps the key; denied is calm', async () => {
  let mode = 'stale';
  const t = await boot({ rows: [WO()], rpcs: { save_work_order_v1: () => (mode === 'stale' ? { error: { code: '40001', message: 'stale version: work order changed since it was loaded' } } : mode === 'drop' ? { error: { message: 'Failed to fetch' } } : { error: { code: '42501', message: 'manage_maintenance denied' } }) } });
  await t.click('open', 'w1'); await t.click('done-start'); await t.type('resolution', 'Fixed it'); await t.click('done-send');
  assert.match(t.text(), /Someone else changed this work order/); assert.ok(!t.html().includes('role="dialog"'));
  mode = 'drop'; await t.click('open', 'w1'); await t.click('done-start'); await t.type('resolution', 'Fixed it'); await t.click('done-send');
  const k1 = t.sent()[1][1].p_idempotency_key; assert.match(t.text(), /connection dropped/); await t.click('done-send');
  assert.equal(t.sent()[2][1].p_idempotency_key, k1, 'same key on retry');
  mode = 'deny'; await t.click('done-send'); assert.match(t.text(), /not allowed/); assert.ok(!/undefined|\[object/.test(t.html()));
});
test('offline: nothing is sent', async () => {
  const env = load({ onLine: false }); const el = new FakeEl(); const c = fakeClient({ rows: [WO()] });
  env.M.mount(el, { client: c, access: { role: 'admin' } }); await tick();
  const fire = (a) => { for (const f of el.l.click) f({ target: { getAttribute: (k) => ({ 'data-o': a })[k] ?? null, closest() { return this; } } }); return tick(); };
  await fire('new'); await fire('new-send'); assert.equal(c.calls.length, 0);
});
test('list states: missing table, denied and load error each show a calm box; no client says no connection', async () => {
  const mk = (error) => { const c = fakeClient(); c.from = errChain(error); return c; };
  assert.match((await boot({ client: mk({ code: '42P01', message: 'relation does not exist' }) })).text(), /not available in this version/);
  assert.match((await boot({ client: mk({ code: '42501', message: 'permission denied' }) })).text(), /not allowed to see/);
  const t = await boot({ client: mk({ message: 'boom' }) }); assert.match(t.text(), /could not be loaded/); assert.ok(t.html().includes('data-o="retry"'));
  assert.match((await boot({ client: null })).text(), /No connection/);
});
test('empty: no open work orders reads calmly', async () => { assert.match((await boot({ rows: [] })).text(), /Nothing is open/); });

const OV = (r = {}) => ({ today: '2026-10-14', nextArrival: { guest: 'Ella Tan', checkin: '2026-10-15' }, readiness: { state: 'awaiting_review', blockingWorkOrders: 1, nextCheckin: '2026-10-15', lastCleaning: { id: 'cs1', cleanedAt: hoursAgo(3), cleaner: 'Ana', complete: true, completionPct: '96', issues: 1 }, review: null, ...r } });
test('readiness: overview call shape, session and evidence reads, every row shown, read only', async () => {
  const t = await boot({ sub: 'ready', rpcs: { get_admin_overview_v1: () => OV() },
    tables: { cleaning_sessions: [{ id: 'cs1', completion_pct: '96', is_complete: true, issue_count: 1, total_photo_count: 14 }], cleaning_verification_evidence: [{ id: 'e1', advisory_result: 'pass', reviews: [{ outcome: 'reviewed', reason: 'Looks clean', reviewed_at: hoursAgo(1) }] }] } });
  assert.deepEqual(t.client.calls[0], ['get_admin_overview_v1', { p_property_id: PROP }]);
  const tx = t.text();
  for (const re of [/waiting for your review/, /Tomorrow, Ella Tan/, /96% · complete/, /Issues noted 1/, /Photos 14/, /Reviewed/, /Looks clean/, /Not reviewed yet/, /1, see the list/]) assert.match(tx, re);
  assert.ok(t.client.chains.every((c) => c.every((r) => !['insert', 'update', 'delete', 'upsert'].includes(r[0]))));
  assert.equal(t.client.calls.length, 1); assert.ok(!t.html().includes('review_property_readiness'));
});
test('readiness: no cleaning on file; a failed detail read is Could not load, never zero', async () => {
  const a = await boot({ sub: 'ready', rpcs: { get_admin_overview_v1: () => OV({ lastCleaning: null, state: 'overdue', daysOverdue: 2 }) } });
  assert.match(a.text(), /No cleaning report, 2 days overdue/); assert.match(a.text(), /No cleaning session on file/);
  const c = fakeClient({ rpcs: { get_admin_overview_v1: () => OV() } }); c.from = errChain({ message: 'x' });
  const b = await boot({ sub: 'ready', client: c }); assert.match(b.text(), /Photos Could not load/); assert.match(b.text(), /Inspector Could not load/); assert.match(b.text(), /96%/);
});
test('readiness: overview denied is calm; switching tabs loads the overview once', async () => {
  const d = await boot({ sub: 'ready', rpcs: { get_admin_overview_v1: () => ({ error: { code: '42501', message: 'denied' } }) } }); assert.match(d.text(), /not allowed to see/);
  const t = await boot({ rows: [WO()], rpcs: { get_admin_overview_v1: () => OV() } });
  await t.click('tab', 'ready'); await t.click('tab', 'orders'); await t.click('tab', 'ready');
  assert.equal(t.client.calls.filter((c) => c[0] === 'get_admin_overview_v1').length, 1);
});
test('inspectorResult picks the newest human review; no reviews is never called a pass', () => {
  const { lib } = load().M;
  assert.equal(lib.inspectorResult([{ reviews: [{ outcome: 'reviewed', reviewed_at: '2026-10-01T00:00:00Z' }, { outcome: 'follow_up_required', reviewed_at: '2026-10-02T00:00:00Z' }] }]).text, 'Follow-up needed');
  assert.equal(lib.inspectorResult([{ advisory_result: 'pass', reviews: [] }]).text, 'Not reviewed yet');
  assert.equal(lib.inspectorResult([]).text, 'No inspection on file');
});
test('demo: sample data, no network, create works end to end', async () => {
  const t = await boot({ demo: true });
  assert.match(t.text(), /Sample: bathroom tap drips/);
  await t.click('new'); await t.type('title', 'Sample new'); await t.click('new-send'); assert.match(t.text(), /Sample new/);
  await t.click('tab', 'ready'); assert.match(t.text(), /Next turnover/);
});
test('layout: 44px targets, 16px inputs, reduced motion, no px font sizes', () => {
  assert.match(CSS, /\.O_tab \{[^}]*min-height: 44px/); assert.match(CSS, /\.O_chip \{[^}]*min-height: 44px/); assert.match(CSS, /\.O_row \{[^}]*min-height: 44px/);
  assert.match(CSS, /\.O_select, \.O_input \{[^}]*max\(1rem/); assert.match(CSS, /prefers-reduced-motion/);
  assert.equal([...CSS.matchAll(/font-size:\s*\d+px/g)].length, 0);
});
