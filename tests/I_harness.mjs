// Lane I test helper (not a test): a tiny fake DOM root, a recording supabase mock and a frozen clock around stock/I_stock.js.
// I_STOCK_SRC overrides the file under test (tests/I_red.mjs uses it to prove each test goes red on a broken copy).
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const here = path.dirname(fileURLToPath(import.meta.url));
export const srcPath = process.env.I_STOCK_SRC || path.join(here, '..', 'stock', 'I_stock.js');
export const NOW = '2026-10-15T04:30:00Z'; // 12:30 Manila, 2026-10-15
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
export const flush = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r)); };

class Kid { constructor() { this.innerHTML = ''; this.textContent = ''; this.attrs = {}; } setAttribute(k, v) { this.attrs[k] = v; } removeAttribute(k) { delete this.attrs[k]; } }
class Root {
  constructor() { this.l = {}; this._h = ''; this.kids = null; }
  set innerHTML(v) { this._h = v; this.kids = { top: new Kid(), list: new Kid(), layer: new Kid(), live: new Kid() }; }
  get innerHTML() { return this._h; }
  addEventListener(t, f) { (this.l[t] ||= []).push(f); }
  removeEventListener(t, f) { this.l[t] = (this.l[t] || []).filter((x) => x !== f); }
  querySelector(sel) { const m = /^\[data-i-(\w+)\]$/.exec(sel); return m && this.kids ? this.kids[m[1]] : null; }
  html() { const k = this.kids; return k ? k.top.innerHTML + k.list.innerHTML + k.layer.innerHTML : ''; }
  sheet() { return this.kids ? this.kids.layer.innerHTML : ''; }
}

export function mockClient(o = {}) {
  const calls = [], handlers = o.rpc || {};
  const ok = { data: { ok: true }, error: null };
  // The server rules we know (SQL read): a count needs a 3+ character note; keys 16-160 characters; a controlled item refuses usage above stock.
  const err = (code, message) => ({ data: null, error: { code, message } });
  const byId = (id) => ((o.catalogue && o.catalogue.items) || []).filter((i) => i.id === id)[0];
  function serverRules(name, a) {
    const key = a.p_idempotency_key || (a.p_rows && a.p_rows[0] && a.p_rows[0].usage_key);
    if (key !== undefined && (String(key).length < 16 || String(key).length > 160)) return err('22023', 'idempotency key required');
    if (name === 'reconcile_inventory_baseline_v1' && String(a.p_note || '').trim().length < 3) return err('22023', 'a count note is required');
    if (name === 'record_inventory_usage') { const i = byId(a.p_rows[0].item_id); if (i && i.movementControlled && i.qty < a.p_rows[0].used_qty) return err('22023', 'insufficient stock for ' + i.name); }
    return null;
  }
  const client = {
    calls,
    rpc(name, args) {
      calls.push(['rpc', name, clone(args)]);
      const h = handlers[name];
      if (!h) return Promise.resolve(name === 'get_inventory_catalogue_v1' ? { data: o.catalogue, error: null } : serverRules(name, args) || ok);
      try { return Promise.resolve(h(args)); } catch (e) { return Promise.reject(e); }
    },
    from(table) {
      const rec = { table, eq: [], in: [] };
      calls.push(['from', table, rec]);
      const q = { select(c) { rec.select = c; return q; }, eq(k, v) { rec.eq.push([k, v]); return q; }, in(k, v) { rec.in.push([k, v]); return q; }, order(c, x) { rec.order = [c, x]; return q; }, limit(n) { rec.limit = n; return q; },
        then(res, rej) { const r = o.from ? o.from(table) : { data: table === 'inventory_shopping_list' ? (o.shop || []) : (o.moves || []), error: null }; return Promise.resolve(r).then(res, rej); } };
      return q;
    },
    auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: o.uid || 'me-1' } } } }) }
  };
  client.rpcCalls = (name) => calls.filter((c) => c[0] === 'rpc' && (!name || c[1] === name));
  return client;
}

export function item(id, name, qty, reorder, extra) {
  return Object.assign({ id, name, category: 'Bathroom', unit: 'rolls', qty, reorderBelow: reorder, consumable: true, active: true, status: 'good', unitCost: 7391.55, purchaseUnit: 'pack', unitsPerPurchase: 12, photo: null, movementControlled: false, baselineNote: null, usage30d: 0, usageDays: 0, avgDaily: null, coverageDays: null, attention: false, estDailyUsage: null, estCoverageDays: null }, extra || {});
}
export const CATALOGUE = { items: [item('i1', 'Toilet paper', 4, 12), item('i2', 'Hand soap', 0, 3, { category: 'Kitchen', unit: 'bottles', purchaseUnit: null, unitsPerPurchase: 1 }), item('i3', 'Bath towels', 14, 10, { category: 'Linen', consumable: false, unit: 'pieces' }), item('i4', 'Old lamp', 1, 5, { active: false })], sourceAsOf: NOW, forecastNote: 'x' };

export async function setup(o = {}) {
  const role = o.role || 'owner', nav = { onLine: true }, toasts = [], navs = [], hapts = [];
  const client = o.demo ? (o.client || null) : (o.client || mockClient({ catalogue: CATALOGUE }));
  let when = new Date(o.now || NOW);
  class FixedDate extends Date { constructor(...a) { if (a.length) super(...a); else super(when.getTime()); } static now() { return when.getTime(); } }
  let n = 0;
  const win = { crypto: { randomUUID: () => 'uuid-' + String(++n).padStart(8, '0') + '-aaaa-bbbb-cccc-dddddddddddd' } };
  if (!('flags' in o)) win.I_STOCK_FLAGS = { count: true, usage: true }; else if (o.flags) win.I_STOCK_FLAGS = o.flags;
  const ctx = { window: win, navigator: nav, Date: FixedDate, console };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(srcPath, 'utf8'), ctx, { filename: 'I_stock.js' });
  const root = new Root();
  const opts = { client, demo: !!o.demo, role, sub: o.sub || '', navigate: (h) => { navs.push(h); if (o.remount !== false) { const m = /^#stock\/?(.*)$/.exec(h); if (m) { opts.sub = m[1]; win.I_Stock.mount(root, opts); } } }, /* the shell re-mounts on a sub-route change */ toast: (m) => toasts.push(m), haptic: (k) => hapts.push(k) };
  if (o.propertyId) opts.propertyId = o.propertyId;
  const fire = async (type, ev) => { for (const f of root.l[type] || []) await f(ev); await flush(); };
  const env = {
    advance: (ms) => { when = new Date(when.getTime() + ms); }, role, client, nav, toasts, navs, hapts, root, win, ctx, lib: win.I_Stock.lib,
    mount: async (sub) => { if (sub !== undefined) opts.sub = sub; win.I_Stock.mount(root, opts); await flush(); },
    unmount: () => win.I_Stock.unmount(),
    act: async (act, extra) => { const attrs = Object.assign({ 'data-act': act }, extra || {}); const t = { getAttribute: (k) => (k in attrs ? attrs[k] : null), closest: (s) => (s === '[data-act]' ? t : null) }; await fire('click', { target: t, preventDefault() {} }); },
    open: (id) => env.act('open', { 'data-id': id }), begin: (kind) => env.act('begin', { 'data-kind': kind }),
    input: (id, value) => fire('input', { target: { id, value } }), submit: () => fire('submit', { preventDefault() {} }), key: (k) => fire('keydown', { key: k }),
    html: () => root.html(), sheet: () => root.sheet(), set opened(v) {}
  };
  return env;
}
export const keysOf = (o) => Object.keys(o).sort();
