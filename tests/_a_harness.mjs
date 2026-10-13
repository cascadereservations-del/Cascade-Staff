// Lane A test harness (not a test file): app.js run against a stub DOM and a fake Supabase, with a frozen clock.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
export const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const require = createRequire(import.meta.url);
export const CS = require('../lib.js');
export const P = require('../pay/pay-lib.js');
export const D = require('../demo.js');
export const TODAY = '2026-10-15';
export const NOW = new Date('2026-10-15T04:30:00Z'); // 12:30 Manila
export function el() {
  const a = {};
  const e = { innerHTML: '', textContent: '', hidden: false, disabled: false, value: '', checked: false, className: '', style: {}, children: [], title: '',
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, setAttribute(k, v) { a[k] = String(v); }, getAttribute: (k) => (k in a ? a[k] : null), removeAttribute(k) { delete a[k]; }, addEventListener() {},
    querySelectorAll: () => [], querySelector: () => null, contains: () => false, focus() {}, scrollIntoView() {}, closest: () => null, appendChild() {}, onclick: null };
  return e;
}
// E_ options (all optional): fold = a fold-manifest.json object; reduced = prefers-reduced-motion; nav = extra navigator members (vibrate); width = innerWidth; ls = a localStorage stand-in; visible = false hides the page.
export async function boot({ role, hash, handlers, now, demo, els: pre, docQuery, serviceWorker, fold, foldFetch, reduced, nav: navExtra, width, ls, visible }) {
  const when = now || NOW;
  class FixedDate extends Date { constructor(...a) { if (a.length) super(...a); else super(when.getTime()); } static now() { return when.getTime(); } }
  const els = pre || {}, listeners = {}, winListeners = {}, calls = [], location = { hash, pathname: '/', search: demo ? '?demo' : '', origin: 'https://staff.example', replace() {} };
  const docObj = { getElementById: (id) => (els[id] ||= el()), querySelector: (q) => (docQuery ? docQuery(q) : null), querySelectorAll: () => [], visibilityState: visible === false ? 'hidden' : 'visible', addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); } };
  const sb = {
    auth: { getSession: () => Promise.resolve({ data: { session: { user: { email: 'ana@staff.cascade.invalid', user_metadata: { display_name: 'Ana' } }, access_token: 't' } } }), signOut: () => Promise.resolve({}) },
    rpc: (name, args) => { calls.push([name, JSON.parse(JSON.stringify(args || {}))]); const h = handlers[name]; if (!h) return Promise.resolve({ error: null, data: null }); const r = h(args); return r && typeof r.then === 'function' ? r : Promise.resolve(JSON.parse(JSON.stringify(r))); },
    storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ error: { message: 'x' } }) }) } };
  const win = { supabase: { createClient: () => sb }, CS, P, CSPay: P, ICON: (n, c) => '<svg class="i ' + (c || '') + '" data-i="' + n + '"></svg>', CSTheme: { get: () => 'auto', set() {}, plainOn: () => false, setPlain() {} },
    addEventListener: (t, fn) => { (winListeners[t] ||= []).push(fn); }, matchMedia: (q) => ({ matches: !!(reduced && /reduced-motion/.test(String(q))) || (/min-width: 37\.5rem/.test(String(q)) && (width || 360) >= 600) }), scrollTo() {}, scrollY: 0, innerWidth: width || 360, localStorage: ls || { getItem: () => null, setItem() {}, removeItem() {} }, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} } };
  if (fold) win.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(fold) });
  if (foldFetch) win.fetch = foldFetch; // F_/E_: a manifest fetch that never answers, or fails
  if (demo) win.CSDemo = { active: true, role: () => role, client: () => sb, fetch: () => Promise.resolve({ ok: false }) };
  const registered = [];
  const nav = Object.assign({ userAgent: 'test' }, navExtra || {}); if (serviceWorker !== false) nav.serviceWorker = { register: (u) => { registered.push(u); return Promise.resolve(); } };
  const ctx = { window: win, document: docObj, location, history: { replaceState(a, b, h) { location.hash = h; } }, navigator: nav, localStorage: win.localStorage, matchMedia: win.matchMedia,
    fetch: () => Promise.resolve({ ok: false }), setTimeout, clearTimeout, console, URL, Image: function () {}, Date: FixedDate, Math, JSON, Promise, crypto: { randomUUID: () => 'uuid' } };
  win.crypto = ctx.crypto; vm.createContext(ctx); vm.runInContext(read('app.js'), ctx);
  const flush = async () => { for (let i = 0; i < 14; i++) await new Promise((r) => setImmediate(r)); }; await flush();
  const click = async (attrs) => { const btn = { getAttribute: (n) => (n in attrs ? attrs[n] : null), hasAttribute: (n) => n in attrs }; for (const fn of listeners.click || []) fn({ target: { closest: () => btn } }); await flush(); };
  const input = (id, value) => { for (const fn of listeners.input || []) fn({ target: { id, value } }); };
  return { els, calls, click, input, flush, listeners, winListeners, registered, location };
}
export const ACCESS = (role) => ({ error: null, data: { role, disabled: false, session_current: true, property_ids: ['prop-1'] } });
export const stayRow = (name, a, b, extra) => Object.assign({ guest_name: name, checkin_date: a, checkout_date: b, status: 'confirmed', source: 'direct' }, extra || {});
export const HOMEWITH = (calendar, extra) => ({ error: null, data: Object.assign({ today: TODAY, warnings: [], calendar, day_flags: [], weather: null, current_guest: null, next_guest: null, generated_at: '2026-10-15T04:00:00Z' }, extra || {}) });
export const NOTASKS = { error: null, data: { ok: true, manager: false, today: TODAY, tasks: [] } };
export const NOTICES_RAW = (extra) => Object.assign({ generated_at: '2026-10-15T02:00:00Z', role: 'admin', house_times: { check_out: '12:00', check_in: '14:00' },
  weather: { source: 'open-meteo', fetched_at: '2026-10-15T02:00:00Z', temp_c: 29, condition: 'Partly cloudy', code: 2, rain_chance_pct: 70, aqi: 42, hourly: [], rain_watch: null },
  notices: [{ id: 'n1', type: 'power', title: 'Brownout 1:00 to 4:00 pm', date: '2026-10-16', start_time: '13:00', end_time: '16:00', source: 'socoteco', detail: null }, { id: 'n2', type: 'water', title: 'No water', date: '2026-10-20', start_time: '09:00', end_time: '15:00', source: 'gscwd', detail: 'Pipe repair' }],
  house: [], inbox_open: 0, sources: { water_page: 'https://www.facebook.com/gscwaterdistrict/', power_page: 'https://www.facebook.com/socoteco2.EC/' } }, extra || {});
export const baseHandlers = (role, over) => Object.assign({ current_staff_access: () => ACCESS(role), staff_home_v1: () => HOMEWITH([]), tasks_list_v1: () => NOTASKS, notices_v1: () => ({ error: null, data: NOTICES_RAW({ role }) }) }, over || {});
