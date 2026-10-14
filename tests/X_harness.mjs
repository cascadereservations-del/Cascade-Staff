// Lane X test helper (not a test): loads inbox/X_inbox.js into a fresh sandbox per test and gives it a very small fake browser.
// Frozen clock: the module's clock is set to a fixed number; nothing here reads the real time.
// Set X_INBOX_FILE to another path (for example an `git show 6a63973:inbox/X_inbox.js` copy) to run the same tests on the old code.
import vm from 'node:vm';
import fs from 'node:fs';

export const NOW = Date.parse('2026-10-14T04:00:00Z');
export const SRC = process.env.X_INBOX_FILE || new URL('../inbox/X_inbox.js', import.meta.url);
export const plain = (x) => JSON.parse(JSON.stringify(x));
export const settle = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

class Region {
  constructor() { this.innerHTML = ''; this.hidden = false; this.attrs = {}; }
  setAttribute(k, v) { this.attrs[k] = v; }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
}
export class Root {
  constructor() { this.regions = {}; this.listeners = {}; this.added = []; this.removed = []; this.focused = []; this.skeleton = ''; this._html = ''; this.writes = 0; }
  set innerHTML(v) { this._html = String(v); this.skeleton = this._html; this.regions = {}; this.writes++; }
  get innerHTML() { return this._html; }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); this.added.push(t); }
  removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter((x) => x !== f); this.removed.push(t); }
  querySelectorAll() { return []; }
  querySelector(sel) {
    let m = /^\[data-xr="(\w+)"\]$/.exec(sel);
    if (m) return this.regions[m[1]] || (this.regions[m[1]] = new Region());
    const all = this.all();
    const has = (needle) => all.indexOf(needle) >= 0;
    if ((sel === '#X_text' && has('id="X_text"')) || (sel === '#X_sh' && has('id="X_sh"')) || (sel === '[data-xfocus]' && has('data-xfocus'))) return { focus: () => this.focused.push(sel) };
    return null;
  }
  html(name) { return (this.regions[name] || { innerHTML: '' }).innerHTML; }
  all() { return Object.keys(this.regions).map((k) => this.regions[k].innerHTML).join('\n'); }
  async emit(type, ev) { for (const f of this.listeners[type] || []) await f(ev); await settle(); }
  // find the rendered button for an action; a button that is not drawn cannot be tapped, a disabled one does not fire
  button(act, v) {
    const re = new RegExp('<button[^>]*data-xa="' + act + '"[^>]*>', 'g');
    for (const tag of this.all().match(re) || []) { if (v == null || tag.indexOf('data-v="' + v + '"') >= 0) return tag; }
    return null;
  }
  async click(act, v, force) {
    const tag = this.button(act, v);
    if (!tag) throw new Error('no button drawn for ' + act + (v != null ? ' ' + v : ''));
    if (!force && / disabled/.test(tag)) return false;
    const attrs = { 'data-xa': act, 'data-v': v == null ? null : String(v) };
    const t = { disabled: / disabled/.test(tag), getAttribute: (k) => (k === 'aria-busy' ? (/aria-busy="true"/.test(tag) ? 'true' : null) : attrs[k] == null ? null : attrs[k]) };
    t.closest = () => t;
    await this.emit('click', { target: t, preventDefault() {} });
    return true;
  }
  async type(text) {
    const t = { value: text, getAttribute: (k) => (k === 'data-xf' ? 'text' : null) };
    await this.emit('input', { target: t });
  }
  async tick(mark) { const t = { checked: mark, getAttribute: (k) => (k === 'data-xf' ? 'mark' : null) }; await this.emit('change', { target: t }); }
  boxText() { const m = /<textarea[^>]*>([^<]*)<\/textarea>/.exec(this.html('ctext')); return m ? m[1] : null; }
}

// a recording client. handlers: { rpc: {name: fn(args)}, fn: {name: fn(body)}, from: fn(table) }
export function mkClient(h = {}) {
  const calls = [];
  const client = {
    calls,
    rpc(name, args) { calls.push(['rpc', name, plain(args)]); const f = (h.rpc || {})[name]; return Promise.resolve(f ? f(args) : { data: null, error: null }); },
    functions: { invoke(name, opts) { calls.push(['fn', name, plain(opts.body), Object.keys(opts)]); const f = (h.fn || {})[name]; return Promise.resolve(f ? f(opts.body) : { data: { ok: true }, error: null }); } },
    from(table) { calls.push(['from', table]); const rows = h.from ? h.from(table) : []; const q = { select: () => q, eq: () => q, limit: () => Promise.resolve({ data: rows, error: null }) }; return q; }
  };
  return client;
}
export const httpErr = (status, code) => ({ data: null, error: { name: 'FunctionsHttpError', message: 'x', context: { status, json: async () => (code ? { error: code } : {}) } } });

export function load(extra = {}) {
  const store = { local: [], session: [], console: [] };
  const spy = (bucket) => ({ getItem: (k) => { store[bucket].push(['get', k]); return null; }, setItem: (k) => { store[bucket].push(['set', k]); }, removeItem: (k) => { store[bucket].push(['remove', k]); } });
  const sandbox = Object.assign({
    window: Object.assign({}, extra.window || {}), localStorage: spy('local'), sessionStorage: spy('session'),
    console: { log: () => store.console.push('log'), warn: () => store.console.push('warn'), error: () => store.console.push('error'), info: () => store.console.push('info'), debug: () => store.console.push('debug') },
    setTimeout, clearTimeout, Date, JSON, Promise, Object, Array, Math, String, Number, Uint8Array, atob, btoa, encodeURIComponent, decodeURIComponent, isFinite, parseFloat, RegExp, Error
  }, extra.globals || {});
  const before = Object.getOwnPropertyNames(sandbox);
  vm.runInNewContext(fs.readFileSync(SRC, 'utf8'), sandbox, { filename: 'X_inbox.js' });
  const X = sandbox.window.X_Inbox;
  X._setClock(() => NOW);
  return { X, sandbox, store, before, newGlobals: Object.getOwnPropertyNames(sandbox).filter((k) => before.indexOf(k) < 0) };
}
export function fullReset(X) { if (X.reset) X.reset(); else { X._clearKeep(); X._clearDrafts(); } }

// fixtures
export const iso = (agoMin) => new Date(NOW - agoMin * 60000).toISOString();
export const PSID = 'demo-psid';
export const listRow = (o = {}) => Object.assign({ psid: PSID, psid_short: 'demo1234', guest_name: 'Honey', updated_at: iso(30), last_role: 'guest', last_text: 'Is early check-in possible?', last_guest_at: iso(30), open_handoffs: 1, human_until: null, last_risk: null }, o);
export const thread = (o = {}) => Object.assign({ psid: PSID, psid_short: 'demo1234', guest_name: 'Honey', updated_at: iso(30), human_until: null, last_risk: null,
  history: [{ role: 'guest', text: 'Hi, is early check-in possible?', at: iso(60) }, { role: 'bot', text: 'Let me ask the host.', at: iso(59) }, { role: 'guest', text: 'We land at 9 am.', at: iso(30) }], handoffs: [] }, o);
export const openHandoff = (o = {}) => Object.assign({ id: 'h-1', status: 'open', risk: 'priority', guest_text: 'We land at 9 am.', sent_text: null, resolved_by: null, resolved_at: null, created_at: iso(29) }, o);

// mount into a fresh Root; role owner by default
export async function mountIt(env, client, o = {}) {
  const el = new Root(), navs = [], toasts = [];
  env.X.mount(el, Object.assign({ client, demo: false, role: 'owner', sub: '', navigate: (h) => navs.push(h), toast: (m) => toasts.push(m), haptic() {}, propertyId: null }, o));
  await settle();
  return { el, navs, toasts };
}
