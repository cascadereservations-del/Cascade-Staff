import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const require = createRequire(import.meta.url);
const CS = require('../lib.js');
const P = require('../pay/pay-lib.js');
const TODAY = '2026-10-06';

// SPEC-44 L4: "Bookings to confirm" row. Pure helpers first, then app.js against the same stub DOM and fake Supabase as tasks.test.mjs.

test('role gate: owner, admin and finance only', () => {
  for (const r of ['owner', 'admin', 'finance']) assert.equal(CS.canSeeBookingsToConfirm(r), true, r);
  for (const r of ['cleaner', 'inspector', 'maintenance', 'guest', '', null, undefined]) assert.equal(CS.canSeeBookingsToConfirm(r), false, String(r));
});

test('count: an array is its length, a whole number passes through, anything else is 0', () => {
  assert.equal(CS.bookingsToConfirmCount([{}, {}, {}]), 3);
  assert.equal(CS.bookingsToConfirmCount(4), 4);
  for (const bad of [null, undefined, {}, { ok: false }, 'x', '5', -1, 1.5, NaN]) assert.equal(CS.bookingsToConfirmCount(bad), 0);
});

test('row shows with N > 0 for a money role and links to the admin Inquiries page', () => {
  const r = CS.bookingsToConfirmRow('admin', [{}, {}]);
  assert.deepEqual({ n: r.n, count: r.count }, { n: 2, count: '2' });
  assert.equal(r.href, 'https://cascadereservations-del.github.io/cascade-admin-dashboard/#/bookings/inquiries');
  assert.equal(CS.bookingsToConfirmRow('finance', 1).count, '1');
  assert.equal(CS.bookingsToConfirmRow('owner', 150).count, '99+');
});

test('row hidden at 0, on error shapes, and for staff roles', () => {
  assert.equal(CS.bookingsToConfirmRow('owner', []), null);
  assert.equal(CS.bookingsToConfirmRow('owner', 0), null);
  assert.equal(CS.bookingsToConfirmRow('owner', null), null);
  assert.equal(CS.bookingsToConfirmRow('owner', { ok: false }), null);
  for (const r of ['cleaner', 'inspector', 'maintenance']) assert.equal(CS.bookingsToConfirmRow(r, [{}, {}]), null);
});

// ------------------------------------------------------------------------------------------------ app.js against a stub DOM
function el() {
  const e = { innerHTML: '', textContent: '', hidden: false, disabled: false, value: '', checked: false, className: '', style: {}, children: [], title: '',
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, setAttribute() {}, getAttribute: () => null, removeAttribute() {}, addEventListener() {},
    querySelectorAll: () => [], querySelector: () => null, focus() {}, scrollIntoView() {}, closest: () => null, appendChild() {}, onclick: null };
  return e;
}
async function boot({ role, hash, handlers }) {
  const els = {}, listeners = {}, calls = [];
  const location = { hash, pathname: '/', search: '', origin: 'https://staff.example', replace() {} };
  const docObj = {
    getElementById: (id) => (els[id] ||= el()), querySelector: () => null, querySelectorAll: () => [], visibilityState: 'visible',
    addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); },
  };
  const sb = {
    auth: { getSession: () => Promise.resolve({ data: { session: { user: { email: 'ana@staff.cascade.invalid', user_metadata: { display_name: 'Ana' } }, access_token: 't' } } }), signOut: () => Promise.resolve({}), },
    rpc: (name, args) => { calls.push([name, JSON.parse(JSON.stringify(args || {}))]); const h = handlers[name]; return Promise.resolve(h ? JSON.parse(JSON.stringify(h(args))) : { error: null, data: null }); },
    storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ error: { message: 'x' } }) }) },
  };
  const win = {
    supabase: { createClient: () => sb }, CS, P, CSPay: P, ICON: (n, c) => `<svg class="i ${c || ''}" data-i="${n}"></svg>`, CSTheme: { get: () => 'auto', set() {} },
    addEventListener() {}, matchMedia: () => ({ matches: false }), scrollTo() {}, scrollY: 0, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  };
  const ctx = { window: win, document: docObj, location, history: { replaceState(a, b, h) { location.hash = h; } }, navigator: { userAgent: 'test' }, localStorage: win.localStorage,
    matchMedia: () => ({ matches: false }), fetch: () => Promise.resolve({ ok: false }), setTimeout, clearTimeout, console, URL, Image: function () {}, Date, Math, JSON, Promise, crypto: { randomUUID: () => 'uuid-fixed-0001' } };
  win.crypto = ctx.crypto;
  vm.createContext(ctx);
  vm.runInContext(read('app.js'), ctx);
  const flush = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r)); };
  await flush();
  const click = async (attrs) => {
    const btn = { getAttribute: (n) => (n in attrs ? attrs[n] : null), hasAttribute: (n) => n in attrs };
    for (const fn of listeners.click || []) fn({ target: { closest: () => btn } });
    await flush();
  };
  const input = (id, value) => { for (const fn of listeners.input || []) fn({ target: { id, value } }); };
  return { els, calls, click, input, flush, location, listeners };
}
const ACCESS = (role) => ({ error: null, data: { role, disabled: false, session_current: true, property_ids: ['prop-1'] } });
const HOME = { error: null, data: { today: TODAY, warnings: [], calendar: [], weather: null, current_guest: null, next_guest: null, generated_at: '2026-10-06T00:00:00Z' } };

const ROW = /Bookings to confirm/;
const handlersFor = (role, inquiry) => ({ current_staff_access: () => ACCESS(role), staff_home_v1: () => HOME, staff_inquiry_payments_v1: inquiry });
const rpcs = (app) => app.calls.filter((c) => c[0] === 'staff_inquiry_payments_v1');

test('cleaner, inspector and maintenance never call staff_inquiry_payments_v1 and never see the row', async () => {
  for (const role of ['cleaner', 'inspector', 'maintenance']) {
    const app = await boot({ role, hash: '', handlers: handlersFor(role, () => ({ error: null, data: [{ id: 'b1' }] })) });
    assert.equal(rpcs(app).length, 0, role);
    assert.doesNotMatch(app.els['v-home'].innerHTML, ROW, role);
  }
});

test('finance calls it once with the property id; Home shows the row with the count, singular at 1, linking to Inquiries', async () => {
  const app = await boot({ role: 'finance', hash: '', handlers: handlersFor('finance', () => ({ error: null, data: [{ id: 'b1', amount: 5000 }, { id: 'b2' }, { id: 'b3' }] })) });
  assert.equal(rpcs(app).length, 1);
  assert.deepEqual(rpcs(app)[0][1], { p_property_id: 'prop-1' });
  const html = app.els['v-home'].innerHTML;
  assert.match(html, ROW);
  assert.match(html, /aria-label="3 bookings to confirm">3</);
  assert.match(html, /href="https:\/\/cascadereservations-del\.github\.io\/cascade-admin-dashboard\/#\/bookings\/inquiries"[^>]*target="_blank"/);
  assert.doesNotMatch(html, /5000/, 'payment rows are not rendered or kept');
  const one = await boot({ role: 'owner', hash: '', handlers: handlersFor('owner', () => ({ error: null, data: [{ id: 'b1' }] })) });
  assert.match(one.els['v-home'].innerHTML, /aria-label="1 booking to confirm">1</);
});

test('Home hides the row at 0 and when the RPC errors or is missing (logged once)', async () => {
  const zero = await boot({ role: 'admin', hash: '', handlers: handlersFor('admin', () => ({ error: null, data: [] })) });
  assert.equal(rpcs(zero).length, 1);
  assert.doesNotMatch(zero.els['v-home'].innerHTML, ROW);
  const bad = await boot({ role: 'admin', hash: '', handlers: handlersFor('admin', () => ({ error: { code: '42883', message: 'function does not exist' }, data: null })) });
  assert.equal(rpcs(bad).length, 1);
  assert.doesNotMatch(bad.els['v-home'].innerHTML, ROW);
  assert.match(bad.els['v-home'].innerHTML, /Admin dashboard/, 'the rest of Home still draws');
});
