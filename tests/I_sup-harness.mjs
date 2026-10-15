// Lane D-client-sup test helper (not a test): a tiny fake DOM, a recording supabase mock, role fixtures and a frozen clock around stock/I_suppliers.js.
// I_SUP_SRC overrides the file under test (used to show each test RED on an empty or broken copy).
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const here = path.dirname(fileURLToPath(import.meta.url));
export const srcPath = process.env.I_SUP_SRC || path.join(here, '..', 'stock', 'I_suppliers.js');
export const NOW = '2026-10-15T04:30:00Z'; // 12:30 Manila
export const PID = '6ae230f4-c189-4547-84b1-cb6e0b2cc9bd';
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
export const flush = async () => { for (let i = 0; i < 14; i++) await new Promise((r) => setImmediate(r)); };

class Stub { constructor() { this.focused = 0; this.value = ''; } focus() { this.focused++; } setSelectionRange() {} }
// An element: innerHTML, listeners, a stub per #id.
export class El {
  constructor() { this.l = {}; this.innerHTML = ''; this.className = ''; this.attrs = {}; this.byId = {}; this.style = {}; }
  addEventListener(t, f) { (this.l[t] ||= []).push(f); }
  removeEventListener(t, f) { this.l[t] = (this.l[t] || []).filter((x) => x !== f); }
  setAttribute(k, v) { this.attrs[k] = v; } removeAttribute(k) { delete this.attrs[k]; }
  querySelector(sel) { const h = /^#([\w-]+)$/.exec(sel); if (!h) return null; return this.byId[h[1]] ||= new Stub(); }
}
export function suppliers() {
  return [
    { id: 's1', name: 'SM Supermarket', phone: '+63 83 552 0001', location: 'KCC Mall, ground floor', maps_url: 'https://maps.example/sm', payment: 'gcash', notes: 'Ask for the senior card; usually 5% off pack prices', active: true, items: 12, last_bought_at: '2026-10-03T05:00:00Z' },
    { id: 's2', name: 'Robinsons', phone: '', location: 'Gaisano Mall', maps_url: '', payment: 'cash', notes: '', active: true, items: 3, last_bought_at: '2026-10-10T05:00:00Z' },
    { id: 's3', name: 'Old Market Stall', phone: '0917 000 0000', location: 'Public market', maps_url: '', payment: 'cash', notes: 'PHP 40 per kilo, cash only', active: false, items: 1, last_bought_at: null },
    { id: 's4', name: 'Hardware Depot', phone: '', location: 'Pioneer Ave', maps_url: 'https://maps.example/hw', payment: null, notes: '', active: true, items: 0, last_bought_at: null }
  ];
}
// R1 as the cleaner gets it: exactly five keys.
export const cleanerRows = () => suppliers().map((s) => ({ id: s.id, name: s.name, location: s.location, maps_url: s.maps_url, active: s.active }));
export const HISTORY = {
  ok: true, unit: 'rolls', units_per_purchase: 12,
  rows: [
    { at: '2026-10-10T05:00:00Z', supplier_id: 's1', supplier: 'SM Supermarket', qty: 24, unit_price: 12.5, pack_price: 150, source: 'app' },
    { at: '2026-09-20T05:00:00Z', supplier_id: 's2', supplier: 'Robinsons', qty: 12, unit_price: 11, pack_price: 132, source: 'telegram' },
    { at: '2026-08-30T05:00:00Z', supplier_id: 's1', supplier: 'SM Supermarket', qty: 12, unit_price: 10, pack_price: 120, source: 'old' }
  ],
  stats: { last: 12.5, last_at: '2026-10-10T05:00:00Z', avg_180d: 11.2, min_365d: 10, n: 3 },
  by_supplier: [{ supplier_id: 's2', name: 'Robinsons', last_unit_price: 11, last_at: '2026-09-20T05:00:00Z', times: 1 }, { supplier_id: 's1', name: 'SM Supermarket', last_unit_price: 12.5, last_at: '2026-10-10T05:00:00Z', times: 2 }],
  jump: { pct: 25, base: 10 }
};

export function mockClient(o = {}) {
  const calls = [], H = o.rpc || {};
  const client = {
    calls,
    rpc(name, args) {
      calls.push(['rpc', name, clone(args)]);
      const h = H[name];
      if (!h) return Promise.resolve({ data: { ok: true }, error: null });
      try { return Promise.resolve(h(args)); } catch (e) { return Promise.reject(e); }
    },
    from() { throw new Error('the supplier module uses RPCs only'); },
    functions: { invoke() { throw new Error('the supplier module uses RPCs only'); } }
  };
  client.rpcCalls = (name) => calls.filter((c) => c[1] === name);
  client.names = () => calls.map((c) => c[1]);
  return client;
}
export const okRows = (rows) => () => ({ data: { ok: true, suppliers: rows }, error: null });

// The module runs in a vm realm, so objects it returns have a foreign prototype; clone the ones the tests deep-compare.
function wrapS(S) {
  if (!S) return S;
  const cl = (x) => (x === undefined || x === null ? x : JSON.parse(JSON.stringify(x)));
  const w = Object.assign({}, S), lib = Object.assign({}, S.lib || {});
  if (S.pick) w.pick = (...a) => S.pick(...a).then(cl);
  ['cheaperLast', 'sparkPoints'].forEach((k) => { if (lib[k]) lib[k] = (...a) => cl(S.lib[k](...a)); });
  w.lib = lib;
  return w;
}
export async function setup(o = {}) {
  const role = o.role || 'owner', nav = { onLine: o.offline ? false : true };
  const toasts = [], undos = [], confirms = [], hapts = [], pending = [];
  const client = o.client || mockClient({ rpc: Object.assign({ inventory_supplier_list_v1: okRows(role === 'cleaner' ? cleanerRows() : suppliers()) }, o.rpc || {}) });
  let n = 0;
  const body = new El(); body.children = [];
  body.appendChild = (e) => { body.children.push(e); }; body.removeChild = (e) => { body.children = body.children.filter((x) => x !== e); };
  const doc = { body, createElement: () => new El(), activeElement: new Stub() };
  const win = { crypto: { randomUUID: () => 'uuid-' + String(++n).padStart(8, '0') + '-aaaa-bbbb-cccc-dddddddddddd' }, document: doc, navigator: nav };
  const ctx0 = { window: win, self: win, navigator: nav, document: doc, console };
  vm.createContext(ctx0);
  vm.runInContext(fs.readFileSync(path.join(here, '..', 'icons.js'), 'utf8'), ctx0, { filename: 'icons.js' });
  vm.runInContext(fs.readFileSync(srcPath, 'utf8'), ctx0, { filename: 'I_suppliers.js' });
  const when = new Date(o.now || NOW).getTime();
  const ctx = {
    client, role, propertyId: PID, esc: (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    toast: (m) => toasts.push(m), haptic: (k) => hapts.push(k), nowMs: () => when,
    confirm: (t) => { confirms.push(t); if (o.hold) return new Promise((r) => pending.push(r)); return Promise.resolve(o.confirm !== false); },
    undo: (label, fn, opts) => undos.push({ label, fn, opts })
  };
  const host = new El();
  const top = () => body.children[body.children.length - 1];
  const fire = async (el, type, ev) => { for (const f of (el.l[type] || [])) await f(ev); await flush(); };
  const tgt = (act, extra) => { const attrs = Object.assign({ 'data-s-act': act }, extra || {}); const t = { tagName: 'BUTTON', getAttribute: (k) => (k in attrs ? attrs[k] : null), closest: (s) => (s === '[data-s-act]' ? t : null) }; return t; };
  const env = {
    S: wrapS(win.I_Suppliers), win, ctx, client, host, doc, body, toasts, undos, confirms, hapts, nav,
    top, sheets: () => body.children.length, sheet: () => (top() ? top().innerHTML : ''), hostHtml: () => host.innerHTML,
    click: (act, extra, el) => fire(el || top(), 'click', { target: tgt(act, extra), preventDefault() {} }),
    clickHost: (act, extra) => fire(host, 'click', { target: tgt(act, extra) }),
    type: (id, value, el) => fire(el || top(), 'input', { target: { id: 'S_f_' + id, value } }),
    submit: (el) => fire(el || top(), 'submit', { preventDefault() {} }),
    key: (k, act, extra) => fire(top(), 'keydown', { key: k, target: act ? Object.assign(tgt(act, extra), { tagName: 'circle' }) : undefined, preventDefault() {} }),
    answer: async (v) => { pending.shift()(v); await flush(); }, pending,
    mountList: async () => { const h = env.S.mountList(host, ctx); await flush(); return h; },
    flush
  };
  return env;
}
export const keysOf = (o) => Object.keys(o).sort();
