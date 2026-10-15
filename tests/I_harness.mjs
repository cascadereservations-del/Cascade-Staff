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

class Kid { constructor() { this.innerHTML = ''; this.textContent = ''; this.attrs = {}; this.srcObject = null; this.played = 0; } play() { this.played++; return Promise.resolve(); } setAttribute(k, v) { this.attrs[k] = v; } removeAttribute(k) { delete this.attrs[k]; } }
class Root {
  constructor() { this.l = {}; this._h = ''; this.kids = null; }
  set innerHTML(v) { this._h = v; this.kids = { top: new Kid(), list: new Kid(), layer: new Kid(), live: new Kid(), undo: new Kid(), video: this.video || (this.video = new Kid()), suphost: new Kid() }; }
  get innerHTML() { return this._h; }
  addEventListener(t, f) { (this.l[t] ||= []).push(f); }
  removeEventListener(t, f) { this.l[t] = (this.l[t] || []).filter((x) => x !== f); }
  querySelector(sel) { const m = /^\[data-i-(\w+)\]$/.exec(sel); if (m) return this.kids ? this.kids[m[1]] : null; const h = /^#([\w-]+)$/.exec(sel); if (h) { this.byId ||= {}; const k = this.byId[h[1]] ||= Object.assign(new Kid(), { focused: 0, value: '', focus() { this.focused++; } }); return k; } return null; }
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
    functions: {
      invoke(name, opts) {
        calls.push(['fn', name, clone(opts && opts.body)]);
        const h = (o.fn || {})[name];
        return Promise.resolve(h ? h(opts && opts.body) : { data: { ok: true }, error: null });
      }
    },
    auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: o.uid || 'me-1' } } } }) }
  };
  client.fnCalls = (name) => calls.filter((c) => c[0] === 'fn' && (!name || c[1] === name));
  client.rpcCalls = (name) => calls.filter((c) => c[0] === 'rpc' && (!name || c[1] === name));
  return client;
}

// s86 D-client-stock: a blob that knows its type and size, a fake document with a canvas that records toBlob calls, and a script loader
// that answers 'ok' (installs the suppliers stub) or 'error' (a 404). Only installed when a test asks for it (setup option doc).
export class FakeBlob { constructor(type, size) { this.type = type; this.size = size; } async arrayBuffer() { return new Uint8Array(this.size).fill(65).buffer; } }
export function fakeDocument(o, win) {
  const d = { hidden: false, activeElement: null, addEventListener() {}, removeEventListener() {}, appended: [], canvases: [] };
  d.createElement = (tag) => {
    if (tag === 'canvas') {
      const c = { tag, width: 0, height: 0, draws: [], blobCalls: [], getContext: () => ({ drawImage: (...a) => c.draws.push(a) }),
        toBlob(cb, type, q) { c.blobCalls.push([type, q]); const spec = (o.encode || ((t) => ({ type: t, size: 90000 })))(type, q, c.blobCalls.length); cb(spec ? new FakeBlob(spec.type, spec.size) : null); } };
      d.canvases.push(c); return c;
    }
    return { tag, rel: '', href: '', src: '' };
  };
  d.head = { appendChild(n) { d.appended.push(n); if (n.tag === 'script') queueMicrotask(() => { if (o.script === 'ok') { win.I_Suppliers = o.suppliers; n.onload && n.onload(); } else n.onerror && n.onerror(); }); } };
  return d;
}
export function item(id, name, qty, reorder, extra) {
  return Object.assign({ par: null, codes: [], id, name, category: 'Bathroom', unit: 'rolls', qty, reorderBelow: reorder, consumable: true, active: true, status: 'good', unitCost: 7391.55, purchaseUnit: 'pack', unitsPerPurchase: 12, photo: null, movementControlled: false, baselineNote: null, usage30d: 0, usageDays: 0, avgDaily: null, coverageDays: null, attention: false, estDailyUsage: null, estCoverageDays: null }, extra || {});
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
  const ctx = { window: win, self: win, navigator: nav, Date: FixedDate, console };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(here, '..', 'icons.js'), 'utf8'), ctx, { filename: 'icons.js' }); // the shell loads icons.js first; the module calls window.ICON
  vm.runInContext(fs.readFileSync(srcPath, 'utf8'), ctx, { filename: 'I_stock.js' });
  const root = new Root();
  const opts = { client, demo: !!o.demo, role, sub: o.sub || '', navigate: (h) => { navs.push(h); if (o.remount !== false) { const m = /^#stock\/?(.*)$/.exec(h); if (m) { const sub = m[1]; Promise.resolve().then(() => { opts.sub = sub; win.I_Stock.mount(root, opts); }); } } }, /* the shell re-mounts on a sub-route change */ toast: (m) => toasts.push(m), haptic: (k) => hapts.push(k) };
  if (o.propertyId) opts.propertyId = o.propertyId;
  // timers and camera: a stub the tests drive by hand (the module reads window.setInterval, BarcodeDetector and navigator.mediaDevices)
  const timers = [], cam = { opened: 0, stopped: 0, found: [], denied: o.camDenied || null, constraints: null, detectCalls: 0 };
  win.setInterval = (fn, ms) => { timers.push({ fn, ms, on: true }); return timers.length; };
  win.clearInterval = (id) => { if (timers[id - 1]) timers[id - 1].on = false; };
  const timeouts = [];
  win.setTimeout = (fn, ms) => { timeouts.push({ fn, ms, on: true }); return timeouts.length; };
  win.clearTimeout = (id) => { if (timeouts[id - 1]) timeouts[id - 1].on = false; };
  if (o.doc) {
    win.document = fakeDocument(o.doc, win); win.btoa = globalThis.btoa; win.revoked = [];
    win.createImageBitmap = async () => ({ width: o.doc.w || 4000, height: o.doc.h || 3000, close() {} });
    win.URL = { createObjectURL: () => 'blob:fake-' + (++n), revokeObjectURL: (u) => win.revoked.push(u) };
    if (o.suppliers && !o.doc.script) win.I_Suppliers = o.suppliers;
  } else if (o.suppliers) win.I_Suppliers = o.suppliers;
  if (o.camera) {
    win.BarcodeDetector = class { static async getSupportedFormats() { return ['ean_13', 'qr_code', 'pdf417']; } constructor(opt) { cam.formats = opt && opt.formats; } async detect() { cam.detectCalls++; return cam.found.length ? [cam.found.shift()] : []; } };
    nav.mediaDevices = { getUserMedia: async (c) => { cam.constraints = c; if (cam.denied) { const e = new Error('denied'); e.name = cam.denied; throw e; } cam.opened++; return { getTracks: () => [{ stop() { cam.stopped++; } }] }; } };
  }
  const fire = async (type, ev) => { for (const f of root.l[type] || []) await f(ev); await flush(); };
  const env = {
    timeouts, fireTimeouts: async () => { for (const t of timeouts.filter((x) => x.on)) { t.on = false; t.fn(); } await flush(); }, undo: () => root.kids.undo.innerHTML,
    timers, cam, tick: async () => { for (const t of timers.filter((x) => x.on)) t.fn(); await flush(); },
    advance: (ms) => { when = new Date(when.getTime() + ms); }, role, client, nav, toasts, navs, hapts, root, win, ctx, lib: win.I_Stock.lib,
    mount: async (sub) => { if (sub !== undefined) opts.sub = sub; win.I_Stock.mount(root, opts); await flush(); },
    unmount: () => win.I_Stock.unmount(),
    act: async (act, extra) => { const attrs = Object.assign({ 'data-act': act }, extra || {}); const t = { getAttribute: (k) => (k in attrs ? attrs[k] : null), closest: (s) => (s === '[data-act]' ? t : null) }; await fire('click', { target: t, preventDefault() {} }); },
    open: (id) => env.act('open', { 'data-id': id }), begin: (kind) => env.act('begin', { 'data-kind': kind }),
    change: (id, files) => fire('change', { target: { id, files, value: 'x' } }), input: (id, value) => fire('input', { target: { id, value } }), submit: () => fire('submit', { preventDefault() {} }), key: (k) => fire('keydown', { key: k }),
    html: () => root.html(), sheet: () => root.sheet(), set opened(v) {}
  };
  return env;
}
export const keysOf = (o) => Object.keys(o).sort();
