// Lane C test helper (not a test): a very small fake browser, enough to run pay/C_admin.js and pay/C_paid-notice.js without a DOM library.
// Frozen clock: nothing here reads the time. Storage objects record every touch so a test can prove the payout QR was never stored.
import vm from 'node:vm';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const req = createRequire(import.meta.url);

export class FakeEl {
  constructor(id) { this.id = id; this._html = ''; this.listeners = {}; this.hidden = false; this.attrs = {}; this.disabled = false; this.files = null; }
  set innerHTML(v) { this._html = String(v); }
  get innerHTML() { return this._html; }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  querySelectorAll() { return []; }
  getAttribute(k) { return this.attrs[k] == null ? null : this.attrs[k]; }
  click() {}
}
// A click target whose closest(sel) answers for the data-* attribute selectors the pages use.
export function target(attrs, cls) {
  const t = { attrs, getAttribute: (k) => (k in attrs ? attrs[k] : null), hasAttribute: (k) => k in attrs, id: attrs.id || '' };
  t.closest = (sel) => {
    const names = sel.split(',').map((s) => s.trim());
    for (const n of names) {
      const m = /^\[([\w-]+)\]$/.exec(n);
      if (m && (m[1] in attrs)) return t;
      if (n === '.appbar a' && cls === 'appbar-a') return t;
    }
    return null;
  };
  return t;
}
export async function fire(el, type, ev) { for (const f of el.listeners[type] || []) await f(ev); await new Promise((r) => setImmediate(r)); }
export const tick = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

export function load(files, ctx) {
  const sandbox = vm.createContext(ctx);
  for (const f of files) vm.runInContext(fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8'), sandbox, { filename: f });
  return sandbox;
}
export function spyStorage() {
  const touched = [];
  const st = { getItem: (k) => { touched.push(['get', k]); return null; }, setItem: (k, v) => { touched.push(['set', k]); }, removeItem: (k) => { touched.push(['remove', k]); } };
  return { st, touched };
}
export { req };
// Real async work (crypto.subtle) finishes on its own schedule: wait for a condition, never for a fixed number of ticks.
export async function until(fn, label = 'condition', max = 200) {
  for (let i = 0; i < max; i++) { if (fn()) return; await new Promise((r) => setTimeout(r, 5)); }
  throw new Error('timed out waiting for ' + label);
}
export const plain = (x) => JSON.parse(JSON.stringify(x));
