// Lane G (Staff 3.2): guests/G_guests.js. Frozen clock: 2026-10-14T03:00:00Z = 11:00 on 2026-10-14 in Manila. Nothing reads the real time.
// The module runs in a vm sandbox with a tiny fake DOM and a fake Supabase client that records every call.
// Call shapes are pinned against literals here and, when the dashboard source is checked out beside this repo, against its api.ts.
// A red-on-old-code run points G_MODULE at a broken copy.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MOD = process.env.G_MODULE || path.join(root, 'guests', 'G_guests.js');
const SRC = fs.readFileSync(MOD, 'utf8');
const CSS = fs.readFileSync(path.join(root, 'guests', 'G_guests.css'), 'utf8');
const DASH = path.join(root, '..', 'admin-dashboard', 'app', 'src', 'features', 'guests', 'api.ts');
const NOW = Date.parse('2026-10-14T03:00:00Z');
const GID = '0a1b2c3d-0000-4000-8000-000000000001', CID = '0a1b2c3d-0000-4000-8000-0000000000c1', CID2 = '0a1b2c3d-0000-4000-8000-0000000000c2';
const PROP = '6ae230f4-c189-4547-84b1-cb6e0b2cc9bd';

// s120: the This stay card is updated in place, so a few of its ids answer querySelector with a node that edits this.html the way the DOM would. `paints` counts whole-page redraws; `log` records focus and scroll calls.
const LIVE = new Set(['G_gout', 'G_gdec', 'G_ginc', 'G_gbk', 'G_sv', 'G_stm', 'G_staywrap', 'G_stay']);
// s120 U5: form fields (input, textarea, select) are modelled like a browser: a redraw replaces them, so typed text, focus and caret are lost unless the module puts them back. `type` is a person typing, `val` reads the field, `active` is the focused id.
const unesc = (v) => String(v).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const PLAIN = new Set(['G_msg', 'G_stmsg', 'G_err', 'G_eerr', 'G_aerr', 'G_rh', 'G_h']); // focusable non-field ids, logged in `focuslog`
class FakeEl {
  constructor() { this.html = ''; this.l = {}; this.nodes = {}; this.paints = 0; this.log = []; this.rotNodes = []; this.fv = {}; this.fn = {}; this.active = null; this.focuslog = []; }
  querySelectorAll(sel) { // [data-path] answers the turned photos; [data-act] answers every control tag, whose `disabled` can be switched in place like the DOM property
    if (/data-path/.test(String(sel))) return this.rotNodes; if (!/data-act/.test(String(sel))) return [];
    const self = this, tags = () => [...self.html.matchAll(/<(?:button|a|label|input)\b[^>]*\bdata-(?:act|pick)="[^"]*"[^>]*>/g)];
    return tags().map((m, n) => ({ getAttribute: (k) => (new RegExp('\\s' + k + '="([^"]*)"').exec(m[0]) || [, null])[1],
      set disabled(v) { const c = tags()[n]; if (!c) return; const t = c[0].replace(/\sdisabled(?=[\s>])/, ''); self.html = self.html.slice(0, c.index) + (v ? t.replace(/>$/, ' disabled>') : t) + self.html.slice(c.index + c[0].length); } }));
  }
  set innerHTML(v) { this.html = String(v); this.paints++; this.fv = {}; this.fn = {}; this.active = null; } // the old fields are gone: typed text and focus with them
  get innerHTML() { return this.html; }
  get ownerDocument() { const self = this; return { get activeElement() { return self.active ? self.querySelector('#' + self.active) : null; } }; }
  addEventListener(t, f) { (this.l[t] ||= []).push(f); }
  removeEventListener(t, f) { this.l[t] = (this.l[t] || []).filter((x) => x !== f); }
  querySelector(sel) { const id = String(sel).replace(/^#/, ''); return this.nodes[id] || this.field(id) || (LIVE.has(id) && this.html.includes('id="' + id + '"') ? this.live(id) : null) || this.plain(id); }
  plain(id) { if (!PLAIN.has(id) || !this.html.includes('id="' + id + '"')) return null; const self = this; return this.fn[id] ||= { id, tagName: 'DIV', focus() { self.active = id; self.focuslog.push(id); } }; }
  field(id) {
    if (this.fn[id]) return this.fn[id].tagName === 'DIV' ? null : this.fn[id];
    const m = new RegExp('<(input|textarea|select)\\b([^>]*\\bid="' + id + '"[^>]*)>').exec(this.html); if (!m) return null;
    let v = ''; const at = m.index + m[0].length;
    if (m[1] === 'input') v = (/ value="([^"]*)"/.exec(m[2]) || [, ''])[1];
    else if (m[1] === 'textarea') v = this.html.slice(at, this.html.indexOf('</textarea>', at));
    else { const body = this.html.slice(at, this.html.indexOf('</select>', at)), o = /<option value="([^"]*)"[^>]*selected/.exec(body) || /<option value="([^"]*)"/.exec(body); v = o ? o[1] : ''; }
    this.fv[id] = unesc(v); const self = this;
    return this.fn[id] = { id, tagName: m[1].toUpperCase(), selectionStart: null, selectionEnd: null, get value() { return self.fv[id]; }, set value(x) { self.fv[id] = x; },
      focus() { self.active = id; self.focuslog.push(id); }, setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; } };
  }
  type(id, v, caret = String(v).length) { const n = this.querySelector('#' + id); if (!n || !n.tagName) throw new Error('no field ' + id); n.value = v; n.focus(); n.selectionStart = n.selectionEnd = caret; }
  val(id) { const n = this.field(id); return n ? n.value : undefined; }
  live(id) {
    const self = this, open = () => new RegExp('<(\\w+)([^>]*\\bid="' + id + '"[^>]*)>').exec(self.html);
    const inner = (v) => { const m = open(); if (!m) return; const at = m.index + m[0].length, end = self.html.indexOf('</' + m[1] + '>', at); self.html = self.html.slice(0, at) + v + self.html.slice(end); };
    const tag = (f) => { const m = open(); if (m) self.html = self.html.replace(m[0], f(m[0])); };
    return { focus(o) { self.log.push(['focus', id, o]); }, scrollIntoView(o) { self.log.push(['scroll', id, o]); },
      setAttribute(k, v) { tag((t) => t.replace(new RegExp('\\s' + k + '="[^"]*"'), '').replace(/>$/, ' ' + k + '="' + v + '">')); }, removeAttribute(k) { tag((t) => t.replace(new RegExp('\\s' + k + '="[^"]*"'), '')); },
      set innerHTML(v) { inner(v); }, set textContent(v) { inner(String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;')); } };
  }
}
const tick = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const plain = (x) => JSON.parse(JSON.stringify(x));

function load() {
  const touched = [];
  const trap = (name) => new Proxy({}, { get: (_, k) => { touched.push(name + '.' + String(k)); return undefined; }, set: () => { touched.push(name + '.set'); return true; } });
  let blobN = 0; const fetched = [], revoked = [];
  const win = {}; // fetch and URL are hidden from Object.keys so the global-names test still sees only G_Guests
  Object.defineProperty(win, 'fetch', { value: (u, o) => { fetched.push([u, o]); return Promise.resolve({ ok: true, blob: () => Promise.resolve({ u }) }); } });
  Object.defineProperty(win, 'URL', { value: { createObjectURL: () => 'blob:t/' + (++blobN), revokeObjectURL: (u) => revoked.push(u) } });
  const ctx = { window: win, localStorage: trap('localStorage'), sessionStorage: trap('sessionStorage'), Intl, Date, Promise, JSON, Math, console, setTimeout, clearTimeout, Uint8Array,
    document: { cookie: '' }, self: win };
  vm.createContext(ctx);
  // s120: the shell's own CS (tierBadge) and ICON, loaded from the real files; hidden from Object.keys like fetch and URL
  for (const f of ['icons.js', 'lib.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
  for (const k of ['CS', 'ICON']) Object.defineProperty(win, k, { value: win[k], enumerable: false, configurable: true });
  vm.runInContext(SRC, ctx, { filename: 'G_guests.js' });
  win.G_Guests._setClock(() => NOW);
  return { M: win.G_Guests, touched, win, fetched, revoked };
}

// One fake client. `tables` maps a table name to a result (or a function returning one); `rpcs` maps an rpc name to a handler; `fn` is the function handler.
function client({ tables = {}, rpcs = {}, fn = null, sign = null } = {}) {
  const calls = [], chains = [], fcalls = [], signed = [], selects = [];
  return {
    calls, chains, fcalls, signed, selects,
    rpc(name, args) {
      calls.push([name, plain(args || {})]);
      const h = rpcs[name]; if (!h) return Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.' + name } });
      const r = h(args); const pr = Promise.resolve(r && r.then ? r : r && ('data' in r || 'error' in r) ? r : { data: r, error: null });
      pr.select = (cols) => { selects.push([name, cols]); return pr; };
      return pr;
    },
    from(table) {
      const rec = [['from', table]]; chains.push(rec);
      const ch = new Proxy({}, { get: (_, k) => {
        if (k === 'then') return (res, rej) => { const t = tables[table]; const v = typeof t === 'function' ? t(rec) : t || { data: [], error: null }; return Promise.resolve(v).then(res, rej); };
        return (...a) => { rec.push([k, ...a]); return ch; };
      } });
      return ch;
    },
    functions: { invoke(name, opts) {
      fcalls.push([name, plain(opts.body)]);
      const r = fn ? fn(opts.body) : { status: 400, j: {} };
      if (r && r.then) return r;
      if (r.status >= 200 && r.status < 300) return Promise.resolve({ data: r.j, error: null });
      return Promise.resolve({ data: null, error: { context: { status: r.status, json: () => Promise.resolve(r.j || {}) } } });
    } },
    storage: { from: (b) => ({ createSignedUrl: (p, s) => { signed.push([b, p, s]); return Promise.resolve(sign ? sign(p) : { data: { signedUrl: 'https://signed.test/' + p }, error: null }); } }) }
  };
}
const FEAT = { guest_id: true, preferences: true, replace_id: true, remove_id: true };
const GUEST = { id: GID, name: 'Ana Maria Reyes', phone: '09171234567', email: 'ana@mail.com', tier: null, total_stays: 2, last_stay_date: '2026-10-12', property_id: PROP };
const PROFILE = { guest_id: GID, stay_preferences: 'Quiet room', tags: ['anniversary'], vip: false, vip_reason: null, version: 4, contact_number: null, birthday: '1990-10-20', id_on_file: true, id_type: 'passport' };
const COMPS = [{ id: CID, guest_id: GID, name: 'Ana Maria Reyes', id_type: 'passport', id_number: 'P1234567', id_photo_path: CID + '/a.jpg' }, { id: CID2, guest_id: GID, name: 'Ben Cruz', id_type: null, id_number: null, id_photo_path: null }];
function detailClient(over = {}) {
  return client({ tables: { guests: { data: GUEST, error: null }, guest_profile_details: { data: PROFILE, error: null } }, rpcs: { list_guest_companions_v1: () => ({ data: COMPS, error: null }), save_guest_profile_v1: () => ({ data: { ok: true, version: 5 }, error: null }),
    save_guest_companion_v1: () => ({ data: { ok: true, id: 'new' }, error: null }), delete_guest_companion_v1: () => ({ data: { ok: true }, error: null }) },
    fn: (b) => (b.action === 'context' ? { status: 200, j: { ok: true, features: FEAT, stay: null } } : { status: 200, j: { ok: true, saved: [] } }), ...over });
}
async function mount(cl, sub = '', role = 'owner', extra = {}) {
  const { M, touched, fetched, revoked, win } = load(); const el = new FakeEl(); const toasts = [];
  M.mount(el, { client: cl, demo: false, role, sub, propertyId: PROP, navigate: () => {}, toast: (m) => toasts.push(m), haptic: () => {}, ...extra });
  await tick();
  return { M, el, touched, toasts, fetched, revoked, win };
}
const click = (el, act, attrs = {}) => { const node = { getAttribute: (k) => (k === 'data-act' ? act : k in attrs ? attrs[k] : k === 'data-' + k ? null : attrs['data-' + k.replace(/^data-/, '')] ?? null) }; return el.l.click[0]({ target: { closest: () => node } }); };
const clickA = (el, act, attrs) => { const a = { 'data-act': act }; for (const [k, v] of Object.entries(attrs || {})) a['data-' + k] = v; return el.l.click[0]({ target: { closest: () => ({ getAttribute: (k) => (k in a ? a[k] : null) }) } }); };
const setNodes = (el, vals) => { for (const [id, v] of Object.entries(vals)) el.nodes[id] = typeof v === 'object' ? { focus() {}, ...v } : { value: v, focus() {} }; };

// ------------------------------------------------------------------------------------------------ pure helpers
test('G: search pattern, birthday maths, stay map, tags and patch', () => {
  const { M } = load(), t = M._t;
  assert.equal(t.searchPattern('ana (reyes), name.eq.x'), '%ana%reyes%name.eq.x%');
  assert.equal(t.searchPattern('  '), null);
  assert.equal(t.searchPattern('%%'), null);
  assert.equal(t.today(), '2026-10-14');
  assert.equal(t.daysToBirthday('1990-10-14', '2026-10-14'), 0);
  assert.equal(t.daysToBirthday('1990-10-20', '2026-10-14'), 6);
  assert.equal(t.daysToBirthday('1990-10-13', '2026-10-14'), 364);
  assert.equal(t.daysToBirthday('nope', '2026-10-14'), null);
  const m = t.stayMap([
    { guest_id: 'a', checkin_date: '2026-10-12', checkout_date: '2026-10-16' }, // in house
    { guest_id: 'b', checkin_date: '2026-10-14', checkout_date: '2026-10-16' }, // arrives today
    { guest_id: 'c', checkin_date: '2026-10-30', checkout_date: '2026-11-02' }, // too far
    { guest_id: 'd', checkin_date: '2026-10-10', checkout_date: '2026-10-14' }, // leaves today: still in house
    { guest_id: 'a', checkin_date: '2026-10-20', checkout_date: '2026-10-22' }, // later stay does not demote
    { guest_id: null, checkin_date: '2026-10-12', checkout_date: '2026-10-16' }], '2026-10-14');
  assert.deepEqual(Object.keys(m).sort(), ['a', 'b', 'd']);
  assert.equal(m.a.state, 'in'); assert.equal(m.b.state, 'arr'); assert.equal(m.d.state, 'in');
  assert.deepEqual(plain(t.tagsFromText(' Vegetarian, anniversary ;vegetarian\nBaby ')), ['vegetarian', 'anniversary', 'baby']);
  const orig = { contact_number: '0917', birthday: null, stay_preferences: 'Quiet', tags: ['a'], vip: false, vip_reason: null };
  assert.deepEqual(plain(t.patch(orig, { contact_number: '0917', birthday: '', stay_preferences: 'Quiet ', tags: ['a'], vip: false, vip_reason: '' })), {});
  assert.deepEqual(plain(t.patch(orig, { contact_number: '0918', birthday: '1990-01-01', stay_preferences: '', tags: ['a', 'b'], vip: true, vip_reason: 'Friend' })),
    { contact_number: '0918', birthday: '1990-01-01', stay_preferences: null, tags: ['a', 'b'], vip: true, vip_reason: 'Friend' });
  assert.equal(t.check({ birthday: '2026-10-15' }, 'ok then', '2026-10-14'), 'Enter a birthday that is a real date and not in the future.');
  assert.equal(t.check({ birthday: '2026-02-30' }, 'ok then', '2026-10-14') !== '', true);
  assert.equal(t.check({}, 'no', '2026-10-14'), 'Add a reason of 3 to 500 characters.');
  assert.equal(t.check({ birthday: '1990-10-20', tags: ['x'] }, 'fine reason', '2026-10-14'), '');
  assert.equal(t.sameName('Ana Reyes', 'Ana Maria Reyes'), true);
  assert.equal(t.sameName('Ben Cruz', 'Ana Maria Reyes'), false);
  assert.equal(t.absent({ code: 'PGRST202' }), true); assert.equal(t.absent({ code: '40001' }), false);
  assert.match(t.rpcText({ code: '40001', message: 'stale version' }), /Someone else changed this guest/);
  assert.match(t.errText(0, ''), /No connection/);
  assert.match(t.errText(429, ''), /Too many/);
  assert.equal(/!/.test(Object.values({ a: t.errText(400, 'bad_field'), b: t.errText(403, ''), c: t.rpcText({ code: '42501' }) }).join(' ')), false); // no exclamation marks
});

// ------------------------------------------------------------------------------------------------ role and storage
test('G: a cleaner or finance role gets a plain note, no listeners and no calls', async () => {
  for (const role of ['cleaner', 'finance', null]) {
    const cl = detailClient();
    const { el } = await mount(cl, '', role);
    assert.match(el.html, /owner and the admins/);
    assert.equal(cl.chains.length + cl.calls.length + cl.fcalls.length, 0);
    assert.equal(Object.keys(el.l).length, 0);
    assert.doesNotMatch(el.html, /Ana|href="#guests\//);
  }
});

test('G: nothing is written to or read from browser storage, and unmount drops the data', async () => {
  const cl = detailClient();
  const { M, el, touched } = await mount(cl, GID);
  assert.match(el.html, /Ana Maria Reyes/);
  assert.deepEqual(touched, []);
  assert.equal(/\blocalStorage\b|\bsessionStorage\b|indexedDB|document\.cookie/.test(SRC.replace(/\/\*[\s\S]*?\*\//g, '')), false);
  M.unmount();
  assert.equal(M._state(), null);
  assert.equal(el.l.click.length, 0);
});

// ------------------------------------------------------------------------------------------------ list
test('G: the list reads guests the way the dashboard does and links each row to #guests/<id>', async () => {
  const cl = client({ tables: {
    guests: { data: [{ id: GID, name: 'Ana Reyes', phone: null, email: null, last_stay_date: '2026-10-12', guest_profile_details: [{ id_on_file: true, birthday: '1990-10-20', contact_number: null, vip: true }] }], count: 1, error: null },
    airbnb_reservations: { data: [{ guest_id: GID, checkin_date: '2026-10-12', checkout_date: '2026-10-16' }], error: null },
    booking_inquiries: { data: [], error: null } } });
  const { el } = await mount(cl, '');
  const g = cl.chains.find((c) => c[0][1] === 'guests');
  const ops = g.map((x) => x[0]);
  assert.deepEqual(g.find((x) => x[0] === 'select').slice(1, 2), ['id,name,phone,email,tier,total_stays,last_stay_date,guest_profile_details(id_on_file,birthday,contact_number,vip),guest_companions(id_photo_path)']);
  assert.ok(g.some((x) => x[0] === 'eq' && x[1] === 'is_active' && x[2] === true));
  assert.ok(g.some((x) => x[0] === 'eq' && x[1] === 'property_id' && x[2] === PROP));
  assert.ok(g.some((x) => x[0] === 'order' && x[1] === 'last_stay_date'));
  assert.ok(g.some((x) => x[0] === 'range' && x[1] === 0 && x[2] === 39));
  assert.ok(ops.includes('order'));
  assert.match(el.html, /href="#guests\/0a1b2c3d-0000-4000-8000-000000000001"/);
  assert.match(el.html, /In house until 16 Oct/);
  assert.match(el.html, /ID on file/); assert.match(el.html, /VIP/); assert.match(el.html, /Birthday in 6 days/);
  assert.match(el.html, /In house/); assert.match(el.html, /Arriving/); // chips appear because both stay reads answered
  assert.doesNotMatch(el.html, /localStorage/);
});

test('G: when the stay reads are refused the In house and Arriving chips hide; the list still works (probe and hide)', async () => {
  const cl = client({ tables: { guests: { data: [{ id: GID, name: 'Ana Reyes', last_stay_date: null, guest_profile_details: null }], count: 1, error: null },
    airbnb_reservations: { data: null, error: { code: '42501', message: 'denied' } }, booking_inquiries: { data: [], error: null } } });
  const { el } = await mount(cl, '');
  assert.match(el.html, /Ana Reyes/);
  assert.doesNotMatch(el.html, /data-v="in"/); assert.doesNotMatch(el.html, /data-v="arr"/);
  assert.match(el.html, /data-v="recent"/);
  assert.doesNotMatch(el.html, /class="errbox/);
});

test('G: In house filters the read to those ids; an empty answer says so; a failed first load shows No connection and Try again, never demo rows', async () => {
  const stays = { airbnb_reservations: { data: [{ guest_id: GID, checkin_date: '2026-10-12', checkout_date: '2026-10-16' }], error: null }, booking_inquiries: { data: [], error: null } };
  const cl = client({ tables: { guests: { data: [{ id: GID, name: 'Ana Reyes', guest_profile_details: null }], count: 1, error: null }, ...stays } });
  const { el } = await mount(cl, '');
  await clickA(el, 'filter', { v: 'in' }); await tick();
  const last = cl.chains.filter((c) => c[0][1] === 'guests').pop();
  assert.ok(last.some((x) => x[0] === 'in' && x[1] === 'id' && x[2][0] === GID));
  await clickA(el, 'filter', { v: 'arr' }); await tick();
  assert.match(el.html, /No arrivals in the next 14 days/);
  const bad = client({ tables: { guests: { data: null, error: { message: 'x' } }, airbnb_reservations: { data: [], error: null }, booking_inquiries: { data: [], error: null } } });
  const b = await mount(bad, '');
  assert.match(b.el.html, /No connection/); assert.match(b.el.html, /Try again/); assert.doesNotMatch(b.el.html, /Ana Reyes|Ben Cruz/);
});

test('G: search sends the dashboard pattern after a pause and ignores a stale answer', async () => {
  const cl = client({ tables: { guests: { data: [], count: 0, error: null }, airbnb_reservations: { data: [], error: null }, booking_inquiries: { data: [], error: null } } });
  const { el } = await mount(cl, '');
  el.l.input[0]({ target: { id: 'G_q', value: 'ana re' } });
  await new Promise((r) => setTimeout(r, 400)); await tick();
  const last = cl.chains.filter((c) => c[0][1] === 'guests').pop();
  assert.ok(last.some((x) => x[0] === 'or' && x[1] === 'name.ilike.%ana%re%,phone.ilike.%ana%re%,email.ilike.%ana%re%'));
  assert.match(el.html, /No guest matches/);
});

// ------------------------------------------------------------------------------------------------ record
test('G: the record reads explicit columns (never the ID number), companions by RPC, and asks the function for its features', async () => {
  const cl = detailClient();
  const { el } = await mount(cl, GID);
  const prof = cl.chains.find((c) => c[0][1] === 'guest_profile_details');
  const cols = prof.find((x) => x[0] === 'select')[1];
  assert.equal(/id_number/.test(cols), false);
  assert.ok(prof.some((x) => x[0] === 'eq' && x[1] === 'guest_id' && x[2] === GID));
  assert.deepEqual(cl.calls[0], ['list_guest_companions_v1', { p_guest_id: GID }]);
  assert.deepEqual(cl.fcalls[0], ['staff-guest-details', { action: 'context', guest_id: GID }]);
  assert.match(el.html, /Ana Maria Reyes/); assert.match(el.html, /1 on file/); assert.match(el.html, /anniversary/);
  assert.match(el.html, /20 Oct 1990/); assert.match(el.html, /Birthday in 6 days/);
  assert.match(el.html, /Add from text, screenshot or photo/);
  assert.match(el.html, /Guest ID/); assert.match(el.html, /ID on file/); assert.match(el.html, /Ben Cruz/);
  assert.doesNotMatch(el.html, /P1234567/); // the ID number is dropped as the rows come in
  assert.doesNotMatch(el.html, /a\.jpg/); // the stored path is not on the page; a signed link is fetched only on tap
  assert.match(el.html, /tel:09171234567/);
});

test('G: an older staff-guest-details (answers 400) hides Add, Replace and Remove; a missing companions RPC hides that card', async () => {
  const cl = detailClient({ fn: () => ({ status: 400, j: { error: 'bad_stay' } }), rpcs: {} });
  const { el } = await mount(cl, GID);
  assert.match(el.html, /Ana Maria Reyes/);
  assert.doesNotMatch(el.html, /Add from text/); assert.doesNotMatch(el.html, /Remove photo/);
  assert.doesNotMatch(el.html, /Replace photo|Add ID photo/);
  assert.doesNotMatch(el.html, /Add a companion/); assert.doesNotMatch(el.html, /class="errbox/);
  assert.match(el.html, /class="G_slot"/); // the slot is kept either way, so nothing jumps
});

test('G: an unknown guest and a failed load are plain sentences with Try again', async () => {
  const none = await mount(detailClient({ tables: { guests: { data: null, error: null }, guest_profile_details: { data: null, error: null } } }), GID);
  assert.match(none.el.html, /no longer on file/);
  const off = await mount(detailClient({ tables: { guests: { data: null, error: { message: 'x' } }, guest_profile_details: { data: null, error: null } } }), GID);
  assert.match(off.el.html, /No connection/); assert.match(off.el.html, /Try again/);
});

test('G: edit saves through save_guest_profile_v1 with only the changed keys, the loaded version and a reason', async () => {
  const cl = detailClient();
  const { el, toasts } = await mount(cl, GID);
  await clickA(el, 'edit');
  assert.match(el.html, /Contact number/); assert.match(el.html, /value="Updated in the Staff app"/);
  setNodes(el, { G_f_phone: '0917 555 0000', G_f_bday: '1990-10-20', G_f_tags: 'Anniversary, baby', G_f_reason: 'Guest asked on Messenger' });
  await clickA(el, 'save-edit'); await tick();
  const save = cl.calls.find((c) => c[0] === 'save_guest_profile_v1');
  assert.deepEqual(save[1], { p_guest_id: GID, p_patch: { contact_number: '0917 555 0000', tags: ['anniversary', 'baby'] }, p_expected_version: 4, p_reason: 'Guest asked on Messenger' });
  assert.match(el.html, /Saved\. Changed: phone, tags\./);
  assert.deepEqual(toasts, ['Saved']);
  // the next edit uses the version the server returned (5)
  await clickA(el, 'edit'); setNodes(el, { G_f_phone: '0917 555 0000', G_f_bday: '1990-10-21', G_f_tags: 'anniversary, baby', G_f_reason: 'Birthday fix' });
  await clickA(el, 'save-edit'); await tick();
  assert.equal(cl.calls.filter((c) => c[0] === 'save_guest_profile_v1')[1][1].p_expected_version, 5);
});

test('G: an untouched edit sends nothing; a bad reason or future birthday is refused before any call', async () => {
  const cl = detailClient();
  const { el } = await mount(cl, GID);
  await clickA(el, 'edit');
  setNodes(el, { G_f_phone: '09171234567', G_f_bday: '1990-10-20', G_f_tags: 'anniversary', G_f_reason: 'Updated in the Staff app' });
  await clickA(el, 'save-edit'); await tick();
  assert.equal(cl.calls.filter((c) => c[0] === 'save_guest_profile_v1').length, 0);
  assert.match(el.html, /Nothing was changed/);
  await clickA(el, 'edit');
  setNodes(el, { G_f_phone: '09171234567', G_f_bday: '2026-10-15', G_f_tags: 'anniversary', G_f_reason: 'ok then' });
  await clickA(el, 'save-edit');
  assert.match(el.html, /not in the future/);
  setNodes(el, { G_f_bday: '1990-10-20', G_f_reason: 'x' });
  await clickA(el, 'save-edit');
  assert.match(el.html, /reason of 3 to 500/);
  assert.equal(cl.calls.filter((c) => c[0] === 'save_guest_profile_v1').length, 0);
});

test('G: a stale version keeps the form and says who to reload for; no overwrite happens', async () => {
  const cl = detailClient({ rpcs: { list_guest_companions_v1: () => ({ data: [], error: null }), save_guest_profile_v1: () => ({ data: null, error: { code: '40001', message: 'stale version: profile changed since it was loaded' } }) } });
  const { el } = await mount(cl, GID);
  await clickA(el, 'edit'); setNodes(el, { G_f_phone: '0999', G_f_bday: '1990-10-20', G_f_tags: 'anniversary', G_f_reason: 'Phone fix' });
  await clickA(el, 'save-edit'); await tick();
  assert.match(el.html, /Someone else changed this guest/); assert.match(el.html, /Contact number/); assert.match(el.html, /value="0999"|0999/);
});

test('G: Add from text: extract body, review sheet, save body with expected_version and reason; a 207 lists what failed', async () => {
  const proposal = { phone: '09175550000', email: null, guests: 2, nationality: null, stay_preferences: 'Allergic to nuts', birthday: '1992-03-04', tags: ['anniversary'], companions: ['Carla Dizon'], ids: [{ image: 0, name: 'Ana Maria Reyes', id_type: 'passport', own: true }], images: ['id'] };
  let saveStatus = 200;
  const cl = detailClient({ fn: (b) => b.action === 'context' ? { status: 200, j: { ok: true, features: FEAT } } : b.action === 'extract' ? { status: 200, j: { ok: true, proposal } } :
    { status: saveStatus, j: { ok: saveStatus === 200, saved: [{ what: 'companion', ok: true }, { what: 'profile', ok: saveStatus === 200, ...(saveStatus === 200 ? {} : { reason: 'changed' }) }] } } });
  const { el } = await mount(cl, GID);
  await clickA(el, 'add-open');
  setNodes(el, { G_text: 'Hi, allergic to nuts, born 4 March 1992, anniversary trip' });
  const win = el; // images are added through the file input; here the text alone is read
  await clickA(el, 'read'); await tick();
  const ext = cl.fcalls.find((c) => c[1].action === 'extract');
  assert.deepEqual(ext[1], { action: 'extract', guest_id: GID, text: 'Hi, allergic to nuts, born 4 March 1992, anniversary trip', images: [] });
  assert.match(win.html, /Check before saving/); assert.match(win.html, /Allergic to nuts/); assert.match(win.html, /1992-03-04/); assert.match(win.html, /Carla Dizon/);
  assert.match(win.html, /Added under what is already noted/);
  setNodes(el, { G_r_phone: '09175550000', G_r_email: '', G_r_pref: 'Allergic to nuts', G_r_bday: '1992-03-04', G_r_tags: 'anniversary, nuts', G_r_reason: 'From the chat', G_cn0: 'Carla Dizon' });
  saveStatus = 207;
  await clickA(el, 'save-add'); await tick();
  const sv = cl.fcalls.filter((c) => c[1].action === 'save').pop()[1];
  assert.deepEqual(sv, { action: 'save', guest_id: GID, reason: 'From the chat', expected_version: 4, phone: '09175550000', stay_preferences: '2026-10-14: Allergic to nuts', birthday: '1992-03-04', tags: ['anniversary', 'nuts'], companions: ['Carla Dizon'] });
  assert.match(el.html, /Companion added\./); assert.match(el.html, /The details were changed by someone else/);
});

test('G: Add from text refuses an empty read and a future birthday before calling the function', async () => {
  const cl = detailClient();
  const { el } = await mount(cl, GID);
  await clickA(el, 'add-open'); setNodes(el, { G_text: '' });
  await clickA(el, 'read');
  assert.match(el.html, /Paste the guest’s message or add a photo first/);
  assert.equal(cl.fcalls.filter((c) => c[1].action === 'extract').length, 0);
});

test('G: Show ID photo signs only on tap, for 300 s, from the private bucket; the link lives in memory only', async () => {
  const cl = detailClient();
  const { el } = await mount(cl, GID);
  assert.equal(cl.signed.length, 0);
  await clickA(el, 'show-id', { id: CID }); await tick();
  assert.deepEqual(cl.signed, [['guest-id-photos', CID + '/a.jpg', 300]]);
  assert.match(el.html, /blob:t\//);
  await clickA(el, 'full', { id: CID });
  assert.match(el.html, /role="dialog"/); assert.match(el.html, /Close/);
  await clickA(el, 'full-close');
  assert.doesNotMatch(el.html, /role="dialog"/);
});

test('G: replace and remove an ID photo go through the function with a reason; removal asks first', async () => {
  let n = 0;
  const cl = detailClient({ fn: (b) => b.action === 'context' ? { status: 200, j: { ok: true, features: FEAT } } : { status: 200, j: { ok: true, saved: [{ what: b.action === 'remove_id' ? 'id_photo_removed' : 'id_photo', ok: true }] } },
    rpcs: { list_guest_companions_v1: () => ({ data: COMPS, error: null }) } });
  const { el } = await mount(cl, GID);
  await clickA(el, 'remove-photo', { id: CID });
  assert.match(el.html, /Remove this ID photo\?/); assert.equal(cl.fcalls.filter((c) => c[1].action === 'remove_id').length, 0);
  await clickA(el, 'confirm-no'); assert.doesNotMatch(el.html, /Remove this ID photo\?/);
  await clickA(el, 'remove-photo', { id: CID }); await clickA(el, 'remove-photo-yes', { id: CID }); await tick();
  assert.deepEqual(cl.fcalls.filter((c) => c[1].action === 'remove_id')[0][1], { action: 'remove_id', guest_id: GID, companion_id: CID, reason: 'ID photo changed in the Staff app' });
  assert.match(el.html, /ID photo removed\./);
  void n;
});

test('G: add and remove a companion use the dashboard RPC shapes', async () => {
  const cl = detailClient();
  const { el } = await mount(cl, GID);
  setNodes(el, { G_newc: '  Dino   Lim ' });
  await clickA(el, 'add-comp'); await tick();
  assert.deepEqual(cl.calls.find((c) => c[0] === 'save_guest_companion_v1'), ['save_guest_companion_v1', { p_guest_id: GID, p_companion_id: null, p_patch: { name: 'Dino Lim' }, p_expected_version: null, p_reason: 'Companion changed in the Staff app' }]);
  await clickA(el, 'remove-comp', { id: CID2 }); assert.match(el.html, /Remove Ben Cruz from this record/);
  await clickA(el, 'remove-comp-yes', { id: CID2 }); await tick();
  assert.deepEqual(cl.calls.find((c) => c[0] === 'delete_guest_companion_v1'), ['delete_guest_companion_v1', { p_companion_id: CID2, p_reason: 'Companion changed in the Staff app' }]);
});

test('G: the guest\'s own row offers no Remove person; a short or numeric companion name is refused', async () => {
  const cl = detailClient();
  const { el } = await mount(cl, GID);
  const ownBlock = el.html.slice(el.html.indexOf('G_hero'), el.html.indexOf('Ben Cruz'));
  assert.doesNotMatch(ownBlock, /remove-comp/);
  setNodes(el, { G_newc: 'A' });
  await clickA(el, 'add-comp');
  assert.match(el.html, /full name/);
  assert.equal(cl.calls.filter((c) => c[0] === 'save_guest_companion_v1').length, 0);
});

// ------------------------------------------------------------------------------------------------ guards
test('G: call shapes match the dashboard api.ts when it is checked out beside this repo', () => {
  if (!fs.existsSync(DASH)) return;
  const api = fs.readFileSync(DASH, 'utf8');
  for (const s of ["'save_guest_profile_v1', { p_guest_id: guestId, p_patch: patch, p_expected_version: expectedVersion, p_reason: reason }",
    "'list_guest_companions_v1', { p_guest_id: guestId }", "'save_guest_companion_v1', { p_guest_id: guestId, p_companion_id: companionId, p_patch: patch, p_expected_version: expectedVersion ?? null, p_reason: reason }",
    "'delete_guest_companion_v1', { p_companion_id: companionId, p_reason: reason }", "from('guest-id-photos')"]) assert.ok(api.includes(s), s);
});

test('G: the script parses, no top-level name repeats, and every global carries the G_ prefix', () => {
  new vm.Script(SRC);
  const top = SRC.split('\n').filter((l) => /^  (function|var) /.test(l)).map((l) => /^  (?:function|var) ([A-Za-z0-9_$]+)/.exec(l)[1]);
  assert.equal(new Set(top).size, top.length, 'duplicate top-level names');
  assert.ok(top.every((n) => /^(G_|S$)/.test(n)), top.filter((n) => !/^(G_|S$)/.test(n)).join());
  const { win } = load();
  assert.deepEqual(Object.keys(win), ['G_Guests']);
});

test('G: the stylesheet keeps text at 13px or more and uses tokens, not hex colours', () => {
  const sizes = [...CSS.matchAll(/font-size:\s*([\d.]+)(px|rem)/g)].map((m) => (m[2] === 'rem' ? Number(m[1]) * 16 : Number(m[1])));
  assert.ok(sizes.every((s) => s >= 13), 'small text: ' + sizes.join());
  assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(CSS), false);
  assert.match(CSS, /prefers-reduced-motion/);
  assert.match(CSS, /overflow-wrap: anywhere/);
});

test('G: copy has no exclamation marks and no console output', () => {
  const strings = [...SRC.matchAll(/'([^'\n]{12,})'/g)].map((m) => m[1]).filter((s) => /[a-z]{3} [a-z]{3}/.test(s));
  assert.deepEqual(strings.filter((s) => /!/.test(s) && !/!==|!=|!\w/.test(s)), []);
  assert.equal(/console\./.test(SRC), false);
});

test('G: the companions read asks only for id, name, id_type and id_photo_path; id_number is never requested', async () => {
  const cl = detailClient();
  await mount(cl, GID);
  assert.deepEqual(cl.selects, [['list_guest_companions_v1', 'id,name,id_type,id_photo_path']]);
  assert.equal(cl.selects.some((x) => /id_number|notes|contact_number/.test(x[1])), false);
});

test('G: a failed companions read shows an error and Try again, not an empty list with a live Add box', async () => {
  const cl = detailClient({ rpcs: { list_guest_companions_v1: () => ({ data: null, error: { code: '08006', message: 'network' } }) } });
  const { el } = await mount(cl, GID);
  assert.match(el.html, /could not load/); assert.match(el.html, /data-act="detail-retry"/);
  assert.doesNotMatch(el.html, /G_newc|No companions or ID photos yet/);
});

test('G: Add from text refuses a tag over 30 characters, the server limit, with a plain sentence', async () => {
  const proposal = { phone: null, email: null, guests: null, nationality: null, stay_preferences: 'Quiet', birthday: null, tags: [], companions: [], ids: [], images: [] };
  const cl = detailClient({ fn: (b) => (b.action === 'context' ? { status: 200, j: { ok: true, features: FEAT } } : { status: 200, j: { ok: true, proposal } }) });
  const { el } = await mount(cl, GID);
  await clickA(el, 'add-open'); setNodes(el, { G_text: 'Quiet please' });
  await clickA(el, 'read'); await tick();
  setNodes(el, { G_r_phone: '', G_r_email: '', G_r_pref: 'Quiet', G_r_bday: '', G_r_tags: 'a'.repeat(31), G_r_reason: 'From the chat' });
  await clickA(el, 'save-add'); await tick();
  assert.match(el.html, /each at most 30 characters/);
  assert.equal(cl.fcalls.filter((c) => c[1].action === 'save').length, 0);
});

test('G: with companions shown and an older function, Replace photo and Add ID photo stay hidden', async () => {
  const cl = detailClient({ fn: () => ({ status: 400, j: { error: 'bad_stay' } }) });
  const { el } = await mount(cl, GID);
  assert.match(el.html, /Add a companion/); assert.match(el.html, /Ben Cruz/);
  assert.doesNotMatch(el.html, /Replace photo|Add ID photo|Remove photo/);
});

test('G: after remove_id also clears the ID flag, the record reloads so ID reads Not on file at once', async () => {
  let flag = true;
  const cl = detailClient({ tables: { guests: { data: GUEST, error: null }, guest_profile_details: () => ({ data: { ...PROFILE, id_on_file: flag }, error: null }) },
    rpcs: { list_guest_companions_v1: () => ({ data: flag ? COMPS : COMPS.map((c) => ({ ...c, id_photo_path: null })), error: null }), delete_guest_companion_v1: () => ({ data: { ok: true }, error: null }) },
    fn: (b) => { if (b.action === 'context') return { status: 200, j: { ok: true, features: FEAT } }; flag = false; return { status: 200, j: { ok: true, saved: [{ what: 'id_photo_removed', ok: true }, { what: 'profile', ok: true }] } }; } });
  const { el } = await mount(cl, GID);
  assert.match(el.html, /ID on file/);
  await clickA(el, 'remove-photo', { id: CID }); await clickA(el, 'remove-photo-yes', { id: CID }); await tick();
  assert.equal(cl.chains.filter((c) => c[0][1] === 'guest_profile_details').length, 2);
  assert.match(el.html, /ID photo removed/); assert.match(el.html, /No ID yet/); assert.doesNotMatch(el.html, /ID on file/);
});

// ------------------------------------------------------------------------------------------------ s90: photo cache and turning
const imgEv = (cls, w, h) => { const box = { cls: new Set(), getAttribute: (k) => (k === 'data-path' ? CID + '/a.jpg' : null), classList: { add: (c) => box.cls.add(c) } };
  return { box, ev: { target: { naturalWidth: w, naturalHeight: h, closest: () => box } } }; };

test('G s90: a second open of the same guest reuses the signed link (no second sign call) and shows the photo without a tap', async () => {
  const cl = detailClient();
  const { M, el, touched } = await mount(cl, GID);
  await clickA(el, 'show-id', { id: CID }); await tick();
  assert.equal(cl.signed.length, 1);
  assert.match(el.html, /loading="lazy" decoding="async"/);
  M.unmount();
  const el2 = new FakeEl();
  M.mount(el2, { client: cl, demo: false, role: 'owner', sub: GID, propertyId: PROP, navigate: () => {}, toast: () => {}, haptic: () => {} }); await tick();
  assert.match(el2.html, /blob:t\//);
  assert.equal(cl.signed.length, 1);
  assert.deepEqual(touched, []); // nothing read from or written to browser storage
  M.reset(); // sign-out
  const el3 = new FakeEl();
  M.mount(el3, { client: cl, demo: false, role: 'owner', sub: GID, propertyId: PROP, navigate: () => {}, toast: () => {}, haptic: () => {} }); await tick();
  assert.doesNotMatch(el3.html, /blob:t\//);
  await clickA(el3, 'show-id', { id: CID }); await tick();
  assert.equal(cl.signed.length, 2);
});

test('G s90: a tall ID photo is turned, and Rotate turns it a quarter each tap', async () => {
  const cl = detailClient();
  const { M, el } = await mount(cl, GID);
  await clickA(el, 'show-id', { id: CID }); await tick();
  const wide = imgEv('', 800, 500); M._onImg(wide.ev); assert.equal(wide.box.cls.size, 0);
  const tall = imgEv('', 500, 800); M._onImg(tall.ev); assert.ok(tall.box.cls.has('G_r270'));
  await clickA(el, 'full', { id: CID }); await tick();
  assert.match(el.html, /class="G_img G_r270"/);
  assert.match(el.html, /data-act="full-rot"/);
  await clickA(el, 'full-rot'); await tick();
  assert.match(el.html, /class="G_img"/); // 270 + 90 = upright
  await clickA(el, 'full-rot'); await clickA(el, 'full-rot'); await tick();
  assert.match(el.html, /class="G_img G_r180"/); // the 180 class
});

// ---- s91: saved rotation
const compPath = CID + '/a.jpg';
const rotDetail = (extra = {}) => client({ tables: { guests: { data: GUEST, error: null }, guest_profile_details: { data: PROFILE, error: null } }, rpcs: { list_guest_companions_v1: () => ({ data: COMPS, error: null }), ...extra },
  fn: (b) => (b.action === 'context' ? { status: 200, j: { ok: true, features: FEAT, stay: null } } : { status: 200, j: { ok: true, saved: [] } }) });

test('G s91: a saved rotation is fetched in one batched call and beats the auto guess', async () => {
  const cl = rotDetail({ staff_photo_rotation_v1: () => ({ data: [{ path: compPath, rotation: 180 }], error: null }) });
  const { M, el } = await mount(cl, GID); await tick();
  const calls = cl.calls.filter((c) => c[0] === 'staff_photo_rotation_v1'); assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][1], { p_paths: [compPath] });
  await clickA(el, 'show-id', { id: CID }); await tick();
  const tall = imgEv('', 500, 800); M._onImg(tall.ev);
  assert.equal(tall.box.cls.has('G_r270'), false, 'saved 180 wins, no auto turn');
  assert.match(el.html, /G_photo G_r180/);
});

test('G s91: the RPC missing falls back to the auto guess (270) silently', async () => {
  const cl = rotDetail();
  const { M, el } = await mount(cl, GID); await tick();
  assert.ok(cl.calls.some((c) => c[0] === 'staff_photo_rotation_v1'));
  assert.doesNotMatch(el.html, /role="alert"/);
  await clickA(el, 'show-id', { id: CID }); await tick();
  const tall = imgEv('', 500, 800); M._onImg(tall.ev); assert.ok(tall.box.cls.has('G_r270'));
});

test('G s91: Rotate saves the new turn and says Saved; a failed save says Could not save but still turns', async () => {
  let fail = false;
  const cl = rotDetail({ set_guest_photo_rotation_v1: (a) => (fail ? { data: null, error: { message: 'x' } } : { data: { ok: true, path: a.p_path, rotation: a.p_rotation }, error: null }) });
  const { el } = await mount(cl, GID); await tick();
  await clickA(el, 'show-id', { id: CID }); await tick();
  await clickA(el, 'full', { id: CID }); await tick();
  await clickA(el, 'full-rot'); await new Promise((r) => setTimeout(r, 700)); await tick();
  const sv = cl.calls.filter((c) => c[0] === 'set_guest_photo_rotation_v1'); assert.equal(sv.length, 1);
  assert.deepEqual(sv[0][1], { p_path: compPath, p_rotation: 90 });
  assert.match(el.html, /aria-live="polite">Saved for everyone</);
  fail = true; await clickA(el, 'full-rot'); await new Promise((r) => setTimeout(r, 700)); await tick();
  assert.match(el.html, /aria-live="polite">Could not save</);
  assert.match(el.html, /G_img G_r180/);
});

test('G s91: a cleaner never reaches the Guests screen, so no rotation call is made', async () => {
  const cl = rotDetail();
  await mount(cl, GID, 'cleaner');
  assert.equal(cl.calls.filter((c) => /rotation/.test(c[0])).length, 0);
});

test('G s90: app.js keeps ID photos in memory only, dedupes requests, and offers Rotate', () => {
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.match(app, /state\.photoReq\[path\]/);
  assert.match(app, /a === 'id-rot'/);
  assert.match(app, /state\.photos = \{\}; state\.photoReq = \{\}; state\.rot = \{\}/); // sign-out drops all three
  assert.equal(/localStorage|sessionStorage|caches\.open|indexedDB/.test(app.slice(app.indexOf('function loadIdPhotos'), app.indexOf('function dropPhotos'))), false);
});

test('G s90: photos are fetched no-store into a blob; expiry, errors and sign-out drop them; a download that lands after sign-out is not stored', async () => {
  const cl = detailClient();
  const { M, el, fetched, revoked } = await mount(cl, GID);
  await clickA(el, 'show-id', { id: CID }); await tick();
  assert.equal(fetched.length, 1); assert.equal(fetched[0][1].cache, 'no-store');
  assert.match(el.html, /src="blob:t\/1"/);
  // the picture fails to show: forgotten, the button returns
  M._onImgErr({ target: { closest: () => ({ getAttribute: () => CID + '/a.jpg' }) } });
  assert.match(el.html, /Show ID photo/); assert.deepEqual(revoked, ['blob:t/1']);
  // expiry: a record left open past the cache time falls back to the button, never an old link
  await clickA(el, 'show-id', { id: CID }); await tick();
  assert.match(el.html, /blob:t\/2/);
  const realNow = Date.now; Date.now = () => realNow() + 31 * 60000;
  try { M._state().d.companions = M._state().d.companions.slice(); await clickA(el, 'detail-retry'); await tick(); } finally { Date.now = realNow; }
  // sign-out while a download is in flight
  M.reset();
  const slow = detailClient(); let release; const gate = new Promise((r) => { release = r; });
  const w = load(); const e2 = new FakeEl();
  const origFrom = slow.storage.from; slow.storage.from = (b) => ({ createSignedUrl: (p) => gate.then(() => origFrom(b).createSignedUrl(p, 300)) });
  w.M.mount(e2, { client: slow, demo: false, role: 'owner', sub: GID, propertyId: PROP, navigate: () => {}, toast: () => {}, haptic: () => {} }); await tick();
  await clickA(e2, 'show-id', { id: CID }); await tick();
  w.M.reset(); release(); await tick(20);
  const e3 = new FakeEl();
  w.M.mount(e3, { client: slow, demo: false, role: 'owner', sub: GID, propertyId: PROP, navigate: () => {}, toast: () => {}, haptic: () => {} }); await tick();
  assert.doesNotMatch(e3.html, /blob:t\//);
});

// ------------------------------------------------------------------------------------------------ s95 tier chip
test('G s95: list rows and guest card show the tier chip, incl. regular; manual VIP + tier vip is one badge', async () => {
  const row = (id, name, tier, vip) => ({ id, name, phone: null, email: null, tier, last_stay_date: '2026-10-12', guest_profile_details: [{ id_on_file: false, birthday: null, contact_number: null, vip }] });
  const cl = client({ tables: { guests: { data: [row('g1', 'Reg Guest', 'regular', false), row('g2', 'Ret Guest', 'returning', false), row('g3', 'Vip Guest', 'vip', true), row('g4', 'Auto Vip', 'vip', false), row('g5', 'No Tier', null, false), row('g6', 'Odd <b>', 'gold', false)], count: 6, error: null },
    airbnb_reservations: { data: [], error: null }, booking_inquiries: { data: [], error: null } } });
  const { el } = await mount(cl, '');
  const rows = el.html.split('<a class="rowi G_row"').slice(1);
  const by = (n) => rows.find((r) => r.includes(n));
  assert.match(by("Reg Guest"), /<span class="T_chip T_c-regular"><svg[^>]*>.*?<\/svg><span>Regular<\/span><\/span>/); // s120: CS.tierBadge chip with its glyph
  assert.match(by('Ret Guest'), /T_c-returning[\s\S]*<span>Returning<\/span>/);
  assert.equal((by('Vip Guest').match(/VIP<\/span>/g) || []).length, 1); // manual flag on and tier vip: one badge
  assert.equal((by('Auto Vip').match(/VIP<\/span>/g) || []).length, 1); // tier vip alone: still one
  assert.doesNotMatch(by('No Tier'), /Regular|Returning|VIP/);
  assert.doesNotMatch(by('Odd'), /Regular|Returning|VIP/); // unknown tier value draws nothing
  const d = await mount(detailClient({ tables: { guests: { data: { ...GUEST, tier: 'regular' }, error: null }, guest_profile_details: { data: PROFILE, error: null } } }), GID);
  assert.match(d.el.html, /G_chipsrow[\s\S]*T_c-regular[\s\S]*Regular · 2 stays<\/span><\/span><\/div>/);
  const v = await mount(detailClient({ tables: { guests: { data: { ...GUEST, tier: 'vip' }, error: null }, guest_profile_details: { data: { ...PROFILE, vip: true }, error: null } } }), GID);
  assert.equal((v.el.html.split('G_chipsrow')[1].split('</div>')[0].match(/VIP<\/span>/g) || []).length, 1);
});

test('G s120: one chip in both apps: null tier with one stay says First stay, no CS draws nothing', async () => {
  const row = (id, name, tier, n) => ({ id, name, phone: null, email: null, tier, total_stays: n, last_stay_date: '2026-10-12', guest_profile_details: [{ id_on_file: false, birthday: null, contact_number: null, vip: false }] });
  const cl = client({ tables: { guests: { data: [row('g1', 'First Guest', null, 1), row('g2', 'Back Guest', null, 3)], count: 2, error: null }, airbnb_reservations: { data: [], error: null }, booking_inquiries: { data: [], error: null } } });
  const { el } = await mount(cl, '');
  assert.match(el.html, /T_c-first[\s\S]*<span>First stay<\/span>/);
  assert.match(el.html, /T_c-returning[\s\S]*<span>Returning · 3rd stay<\/span>/);
  const d = await mount(detailClient({ tables: { guests: { data: { ...GUEST, total_stays: 1 }, error: null }, guest_profile_details: { data: PROFILE, error: null } } }), GID);
  assert.match(d.el.html, /G_hero[\s\S]*T_c-first/);
  const L = load(); delete L.win.CS; // no CS at runtime: the chip is left out, nothing throws
  const el2 = new FakeEl(); L.M.mount(el2, { client: detailClient(), demo: false, role: 'owner', sub: GID, propertyId: PROP, navigate: () => {}, toast: () => {}, haptic: () => {} }); await tick();
  assert.match(el2.html, /Ana Maria Reyes/); assert.doesNotMatch(el2.html, /T_chip/);
});

// ------------------------------------------------------------------------------------------------ s120: the This stay card (staff_guest_stay_v1, set_stay_guest_count_v1; contract docs/s120/CONTRACT-guest-count.md)
const STAY = { uid: 'stay-uid-1', checkin_date: '2026-10-13', checkout_date: '2026-10-16', booked_guests: 3, guest_count: 2, version: 4 };
const stayClient = (stay, set) => detailClient({ rpcs: {
  list_guest_companions_v1: () => ({ data: COMPS, error: null }), staff_guest_stay_v1: typeof stay === 'function' ? stay : () => ({ data: stay, error: null }),
  ...(set ? { set_stay_guest_count_v1: set } : {}) } });
const outN = (el) => +/<output[^>]*>(\d)<\/output>/.exec(el.html)[1];
const demoMount = async (M, sub) => { const el = new FakeEl(); M.mount(el, { client: null, demo: true, role: 'owner', sub, propertyId: PROP, navigate: () => {}, toast: () => {}, haptic: () => {} }); await tick(); return el; };

test('G: This stay card: heading, dates, stepper 1 to 3, Save and Cancel only after a change', async () => {
  const cl = stayClient(STAY), { el } = await mount(cl, GID);
  assert.deepEqual(cl.calls.find((c) => c[0] === 'staff_guest_stay_v1'), ['staff_guest_stay_v1', { p_property: PROP, p_guest_id: GID }]);
  assert.match(el.html, />This stay</); assert.doesNotMatch(el.html, />Next stay</); assert.match(el.html, /13 → 16 Oct/);
  assert.equal(outN(el), 2); assert.doesNotMatch(el.html, /data-act="stay-save"/); assert.doesNotMatch(el.html, /data-act="stay-undo"/);
  assert.match(el.html, /Booked for 3, staying 2/);
  await clickA(el, 'stay-inc'); assert.equal(outN(el), 3); assert.match(el.html, /data-act="stay-save"/); assert.match(el.html, /data-act="stay-undo"/);
  assert.match(el.html, /id="G_ginc"[^>]*aria-disabled="true"/); await clickA(el, 'stay-inc'); assert.equal(outN(el), 3, 'stops at 3');
  await clickA(el, 'stay-dec'); await clickA(el, 'stay-dec'); assert.equal(outN(el), 1); assert.match(el.html, /id="G_gdec"[^>]*aria-disabled="true"/);
  await clickA(el, 'stay-dec'); assert.equal(outN(el), 1, 'stops at 1');
  await clickA(el, 'stay-undo'); assert.equal(outN(el), 2); assert.doesNotMatch(el.html, /data-act="stay-save"/);
  assert.match(CSS, /\.G_stb \{[^}]*width: 44px; height: 44px/);
});

const booked = (el) => (/id="G_gbk">([^<]*)</.exec(el.html) || [])[1];
test('G: the booked line is always there when the booked number is known and follows the stepper (mockup: Booked for B, staying D)', async () => {
  const { el } = await mount(stayClient({ ...STAY, guest_count: 3 }), GID);
  assert.equal(booked(el), 'Booked for 3');
  const b = await mount(stayClient({ ...STAY, guest_count: null, booked_guests: 2 }), GID);
  assert.equal(outN(b.el), 2); assert.equal(booked(b.el), 'Booked for 2');
  await clickA(b.el, 'stay-dec'); assert.equal(booked(b.el), 'Booked for 2, staying 1');
  await clickA(b.el, 'stay-inc'); assert.equal(booked(b.el), 'Booked for 2');
  await clickA(b.el, 'stay-inc'); assert.equal(booked(b.el), 'Booked for 2, staying 3');
  const none = await mount(stayClient({ ...STAY, guest_count: 2, booked_guests: null }), GID);
  assert.equal(booked(none.el), '', 'no booked number, no line'); assert.equal(outN(none.el), 2);
});

test('G s120: one count rule for Today and the card: 1 to 3, a booked number over 3 reads 3 and is not shown as a staff correction', async () => {
  const { M, win } = load();
  for (const [g, want] of [[{ staying: { booked_guests: 4 } }, 3], [{ staying: { guest_count: 2, booked_guests: 4 } }, 2], [{ staying: { booked_guests: 2.4 } }, 2], [{ staying: { booked_guests: 0.4 } }, null], [{ staying: { booked_guests: 0 } }, null], [{ num_guests: 9 }, 3]]) {
    assert.equal(win.CS.goodToKnow(g, false).guests, want, JSON.stringify(g));
    const sy = g.staying || {}, card = M._t.stayFrom({ uid: 'u', checkin_date: '2026-10-13', checkout_date: '2026-10-16', guest_count: sy.guest_count, booked_guests: sy.booked_guests !== undefined ? sy.booked_guests : g.num_guests, version: 1 }, 1);
    if (g.staying) assert.equal(card.base, want == null ? 1 : want, 'the card shows the same number as Today: ' + JSON.stringify(g));
  }
  const { el } = await mount(stayClient({ ...STAY, guest_count: null, booked_guests: 4 }), GID);
  assert.equal(outN(el), 3); assert.equal(booked(el), 'Booked for 3'); assert.doesNotMatch(el.html, /staying/);
});

test('G: a stay that starts after today is headed Next stay, and the list reads Next stay for a date still ahead', async () => {
  const { el } = await mount(stayClient({ ...STAY, checkin_date: '2026-10-20', checkout_date: '2026-10-22' }), GID);
  assert.match(el.html, />Next stay</); assert.doesNotMatch(el.html, />This stay</);
  const { M } = load();
  assert.match(M._t.stayLine({ last_stay_date: '2026-10-20' }, null, '2026-10-14'), /^Next stay /);
  assert.match(M._t.stayLine({ last_stay_date: '2026-10-12' }, null, '2026-10-14'), /^Last stay /);
});

test('G: Save sends the exact payload, keeps the key for the same count, and uses the version it read', async () => {
  const seen = [];
  const cl = stayClient(STAY, (a) => { seen.push(plain(a)); return seen.length === 1 ? { data: null, error: { message: 'TypeError: Failed to fetch', code: '' }, status: 0 } : { data: { ok: true, guest_count: seen.length === 2 ? 3 : 2, version: seen.length === 2 ? 5 : 6 }, error: null }; });
  const { el } = await mount(cl, GID);
  await clickA(el, 'stay-inc'); await clickA(el, 'stay-save'); await tick();
  assert.deepEqual(Object.keys(seen[0]).sort(), ['p_count', 'p_expected_version', 'p_idempotency_key', 'p_property', 'p_reason', 'p_uid']);
  assert.equal(seen[0].p_property, PROP); assert.equal(seen[0].p_uid, 'stay-uid-1'); assert.equal(seen[0].p_count, 3); assert.equal(seen[0].p_expected_version, 4);
  assert.equal(seen[0].p_reason, 'Guest count changed in the Staff app'); assert.match(seen[0].p_idempotency_key, /^guests-/);
  assert.match(el.html, /The save could not be confirmed\. On file now: 2 guests\. If that is not what you set, tap Save again\./); assert.doesNotMatch(el.html, /Nothing was (saved|changed)/, 'a dropped answer may have saved: never claim nothing changed'); assert.equal(outN(el), 3);
  await clickA(el, 'stay-save'); await tick();
  assert.equal(seen[1].p_idempotency_key, seen[0].p_idempotency_key, 'a retry of the same count reuses the key');
  assert.match(el.html, /Saved\. 3 guests\./); assert.doesNotMatch(el.html, /data-act="stay-save"/); assert.match(el.html, /Booked for 3, staying 3|<output[^>]*>3<\/output>/);
  await clickA(el, 'stay-dec'); await clickA(el, 'stay-save'); await tick();
  assert.equal(seen[2].p_expected_version, 5, 'the saved version is used next'); assert.notEqual(seen[2].p_idempotency_key, seen[0].p_idempotency_key, 'a new count gets a new key');
});

test('G: a version conflict (40001) reloads the card and says so plainly', async () => {
  let n = 0;
  const cl = stayClient(() => ({ data: n++ === 0 ? STAY : { ...STAY, guest_count: 1, version: 9 }, error: null }), () => ({ data: null, error: { code: '40001', message: 'stale version' } }));
  const { el } = await mount(cl, GID);
  await clickA(el, 'stay-inc'); await clickA(el, 'stay-save'); await tick();
  assert.equal(cl.calls.filter((c) => c[0] === 'staff_guest_stay_v1').length, 2, 'the card was read again');
  assert.match(el.html, /This stay was updated by someone else\. It now shows 1 guest\./); assert.doesNotMatch(el.html, /changed the number|number of guests (was )?changed/); assert.equal(outN(el), 1); assert.doesNotMatch(el.html, /data-act="stay-save"/);
});

test('G: 40001 with a reload that fails says to reload the page, never that the latest number is shown', async () => {
  let n = 0;
  const cl = stayClient(() => (n++ === 0 ? { data: STAY, error: null } : { data: null, error: { message: 'TypeError: Failed to fetch', code: '' }, status: 0 }), () => ({ data: null, error: { code: '40001', message: 'stale version' } }));
  const { el } = await mount(cl, GID);
  await clickA(el, 'stay-inc'); await clickA(el, 'stay-save'); await tick();
  assert.match(el.html, /updated by someone else, and the latest count could not load\. Reload the page to see it\./); assert.doesNotMatch(el.html, /It now shows|latest number is shown/);
});

test('G: P0002 says the stay left the calendar and reads the card again; with no stay left the card goes', async () => {
  let n = 0;
  const gone = (reread) => stayClient(() => (n++ === 0 ? { data: STAY, error: null } : reread), () => ({ data: null, error: { code: 'P0002', message: 'stay_not_found' } }));
  const a = await mount(gone({ data: { ...STAY, guest_count: 1, version: 7 }, error: null }), GID);
  await clickA(a.el, 'stay-inc'); await clickA(a.el, 'stay-save'); await tick();
  assert.match(a.el.html, /This stay is no longer on the calendar\./); assert.equal(outN(a.el), 1, 'the card was read again');
  n = 0; const b = await mount(gone({ data: null, error: null }), GID);
  await clickA(b.el, 'stay-inc'); await clickA(b.el, 'stay-save'); await tick();
  assert.match(b.el.html, /This stay is no longer on the calendar\./); assert.doesNotMatch(b.el.html, /<output/);
});

test('G: a replayed save reads the card again before it shows the result; success tells the shell to refresh Today', async () => {
  let n = 0, changed = 0;
  const cl = stayClient(() => (n++ === 0 ? { data: STAY, error: null } : { data: { ...STAY, guest_count: 3, version: 8 }, error: null }), () => ({ data: { ok: true, guest_count: 3, version: 5, replay: true }, error: null }));
  const { el } = await mount(cl, GID, 'owner', { onChange: () => changed++ });
  await clickA(el, 'stay-inc'); await clickA(el, 'stay-save'); await tick();
  assert.equal(cl.calls.filter((c) => c[0] === 'staff_guest_stay_v1').length, 2, 'reloaded on a replay');
  assert.match(el.html, /Saved\. 3 guests\./); assert.equal(outN(el), 3); assert.equal(changed, 1);
  await clickA(el, 'stay-dec'); await clickA(el, 'stay-save'); await tick(); // a second save from the reloaded card uses ITS version
  assert.equal(cl.calls.filter((c) => c[0] === 'set_stay_guest_count_v1')[1][1].p_expected_version, 8);
});

test('G: stepper taps update the card in place: no page redraw, the live region and More details stay', async () => {
  const { el } = await mount(stayClient(STAY), GID), paints = el.paints;
  await clickA(el, 'stay-inc'); await clickA(el, 'stay-dec'); await clickA(el, 'stay-dec'); await clickA(el, 'stay-undo');
  assert.equal(el.paints, paints, 'no whole-page repaint');
  assert.match(el.html, /<output id="G_gout" aria-live="polite">2<\/output>/);
  assert.match(el.html, /<details class="card list G_group G_opt">/);
});

test('G: #guests/<id>/stay scrolls to and focuses the card once; a plain guest page focuses the name', async () => {
  const a = await mount(stayClient(STAY), GID + '/stay');
  assert.deepEqual(a.el.log.map((x) => x[0] + ':' + x[1]), ['focus:G_stay', 'scroll:G_stay']);
  assert.match(a.el.html, /id="G_stay" tabindex="-1"/);
  assert.match(CSS, /\.G_cap \{[^}]*scroll-margin-top/);
  const b = await mount(stayClient(STAY), GID); assert.equal(b.el.log.length, 0, 'plain #guests/<id> keeps today\'s behaviour');
});

test('G: other errors are said in words; a missing function or a null answer draws no card and no error', async () => {
  const set = (code) => stayClient(STAY, () => ({ data: null, error: { code, message: 'x' } }));
  for (const [code, re] of [['42501', /not allowed/], ['22023', /Choose 1, 2 or 3 guests/]]) {
    const { el } = await mount(set(code), GID); await clickA(el, 'stay-inc'); await clickA(el, 'stay-save'); await tick(); assert.match(el.html, re, code);
  }
  for (const stay of [() => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }), () => ({ data: null, error: { code: '42883', message: 'x' } }), () => ({ data: null, error: { status: 404, message: 'x' } }), null]) {
    const { el } = await mount(stayClient(stay), GID);
    assert.doesNotMatch(el.html, /This stay|Next stay<|G_stay|<output/); assert.doesNotMatch(el.html, /class="errbox/); assert.match(el.html, /Ana Maria Reyes/);
  }
  const none = await mount(detailClient(), GID); assert.doesNotMatch(none.el.html, /<output/); // an older server with no stay function at all
});

test('G: demo mode shows a current and a next stay and saves a count without a server', async () => {
  const { M } = load(), el = await demoMount(M, '00000000-0000-4000-8000-0000000000d1');
  assert.match(el.html, />This stay</); assert.equal(outN(el), 2);
  await clickA(el, 'stay-inc'); await clickA(el, 'stay-save'); await tick();
  assert.match(el.html, /Saved\. 3 guests\. Demo only, nothing was sent\./); assert.equal(outN(el), 3);
  const two = await demoMount(M, '00000000-0000-4000-8000-0000000000d2');
  assert.match(two.html, />Next stay</); assert.match(two.html, /No ID yet/);
  assert.doesNotMatch(two.html + el.html, /Ana Reyes|Ben Cruz/);
});

test('G s120: demo shows every state with no storage or client call: Guest ID with and without a photo, Add ID photo, People, Add from text', async () => {
  const { M, touched } = load();
  const one = await demoMount(M, '00000000-0000-4000-8000-0000000000d1'), oneHtml = one.html;
  assert.match(oneHtml, /Guest ID/); assert.match(oneHtml, /ID on file/); assert.match(oneHtml, /data-act="show-id"/); assert.match(oneHtml, /Demo Companion/); assert.match(oneHtml, /People and ID photos/);
  assert.match(oneHtml, /Add from text, screenshot or photo/); assert.match(oneHtml, /Add a companion/);
  await clickA(one, 'show-id', { id: 'demo-c1' }); await tick();
  assert.match(one.html, /Demo only\. No ID photos are stored\./);
  const two = await demoMount(M, '00000000-0000-4000-8000-0000000000d2');
  assert.match(two.html, /No ID photo yet/); assert.match(two.html, /No ID yet/); assert.match(two.html, /Add ID photo/); assert.match(two.html, /Demo Friend/); assert.match(two.html, /Add from text, screenshot or photo/);
  assert.deepEqual(touched, [], 'no storage, and a demo has no client to call');
});

test('G s120: Edit details is the app bar title while the form is open, and no second heading is added to the page', async () => {
  const titles = [], cl = detailClient(), { el } = await mount(cl, GID, 'owner', { setTitle: (t) => titles.push(t) });
  await clickA(el, 'edit'); assert.deepEqual(titles, ['Edit details']);
  assert.doesNotMatch(el.html, /<h[1-3][^>]*>[^<]*Edit details/); assert.equal((el.html.match(/<h2/g) || []).length, 1, 'only the name');
  await clickA(el, 'edit-cancel'); assert.deepEqual(titles, ['Edit details', '']);
});

test('G s120: the CSS has the four G_frwrap grid rules, no dead G_dl or G_namerow, and the profile read no longer asks for id_type', () => {
  for (const r of [/\.G_frwrap \.G_frm \{[^}]*grid-template-columns: 1fr auto/, /\.G_frwrap \.G_fl \{[^}]*grid-column: 1/, /\.G_frwrap \.G_fv \{[^}]*white-space: nowrap/, /\.G_frwrap \.chev \{[^}]*grid-row: 1 \/ 3/]) assert.match(CSS, r);
  assert.doesNotMatch(CSS, /G_dl|G_namerow/); assert.doesNotMatch(SRC, /id_on_file,id_type/);
});

// ------------------------------------------------------------------------------------------------ s120 U3 (re-plan): one rule per fact, save results, repaint
const idChips = (el) => el.html.split('G_chipsrow')[1].split('</div>')[0];
const FAILED = { data: null, error: { message: 'TypeError: Failed to fetch' } };

test('G U3: ID status on the guest page is the Today rule (flag OR any companion photo); unknown shows no pill, never No ID yet', async () => {
  const P = (f) => ({ data: { ...PROFILE, id_on_file: f }, error: null }), ok = (c) => () => ({ data: c, error: null }), none = COMPS.map((c) => ({ ...c, id_photo_path: null }));
  const cases = [['flag false, companion photo', P(false), ok(COMPS), 'ID on file'], ['flag true, no photos', P(true), ok(none), 'ID on file'], ['flag false, no photos', P(false), ok(none), 'No ID yet'],
    ['profile read failed, no photo', FAILED, ok(none), null], ['profile read failed, companion photo', FAILED, ok(COMPS), 'ID on file'],
    ['companions read failed, flag false', P(false), () => FAILED, null], ['companions read failed, flag true', P(true), () => FAILED, 'ID on file'],
    ['companions function missing, flag false', P(false), () => ({ data: null, error: { code: 'PGRST202', message: 'x' } }), null]];
  for (const [what, prof, comps, want] of cases) {
    const { el } = await mount(detailClient({ tables: { guests: { data: GUEST, error: null }, guest_profile_details: prof }, rpcs: { list_guest_companions_v1: comps } }), GID);
    const chips = idChips(el);
    if (want) { assert.match(chips, new RegExp(want), what); assert.doesNotMatch(chips, want === 'ID on file' ? /No ID yet/ : /ID on file/, what); } else assert.doesNotMatch(chips, /ID on file|No ID yet/, what);
  }
});

test('G U4: the list applies the one ID rule: flag true, or any companion photo; no profile row with an empty companion list is No ID yet; companions missing shows no pill', async () => {
  const D = (f) => [{ id_on_file: f, birthday: null, contact_number: null, vip: false }], ph = [{ id_photo_path: 'c/a.jpg' }, { id_photo_path: null }], nop = [{ id_photo_path: null }];
  const row = (id, d, c) => ({ id, name: 'Guest ' + id, phone: null, email: null, tier: null, last_stay_date: '2026-10-12', guest_profile_details: d, ...(c === undefined ? {} : { guest_companions: c }) });
  const rows = [row('g1', D(true), nop), row('g2', D(false), ph), row('g3', D(false), nop), row('g4', [], []), row('g5', D(false)), row('g6', D(false), null)];
  const cl = client({ tables: { guests: { data: rows, count: 6, error: null }, airbnb_reservations: { data: [], error: null }, booking_inquiries: { data: [], error: null } } });
  const { el } = await mount(cl, ''), out = el.html.split('<a class="rowi G_row"').slice(1);
  assert.equal(out.length, 6);
  assert.match(out[0], /ID on file/); assert.match(out[1], /ID on file/); assert.doesNotMatch(out[1], /No ID yet/);
  assert.match(out[2], /No ID yet/); assert.doesNotMatch(out[2], /ID on file/);
  assert.match(out[3], /No ID yet/, 'no profile row, empty companion array: known, so No ID yet');
  assert.doesNotMatch(out[4], /ID on file|No ID yet/, 'companions missing from the row'); assert.doesNotMatch(out[5], /ID on file|No ID yet/, 'companions null');
  assert.doesNotMatch(el.html, /c\/a\.jpg|guest_companions|id_photo_path/, 'a path never reaches the page');
  const d = await mount(detailClient({ tables: { guests: { data: GUEST, error: null }, guest_profile_details: { data: { ...PROFILE, id_on_file: true }, error: null } } }), GID);
  assert.match(idChips(d.el), /ID on file/, 'a true flag reads the same on the page');
});

test('G U4: the demo list shows ID on file for Demo Guest One and No ID yet for Demo Guest Two (detailsOk true on the demo page)', async () => {
  const { M } = load(), list = await demoMount(M, ''), rows = list.html.split('<a class="rowi G_row"').slice(1);
  assert.match(rows[0], /ID on file/); assert.match(rows[1], /No ID yet/);
  const two = await demoMount(load().M, '00000000-0000-4000-8000-0000000000d2');
  assert.match(idChips(two), /No ID yet/); assert.doesNotMatch(idChips(two), /ID on file/);
  const one = await demoMount(load().M, '00000000-0000-4000-8000-0000000000d1');
  assert.match(idChips(one), /ID on file/);
});

test('G U4: a replayed save whose re-read count differs from the one entered does not claim it saved that number; a matching count keeps the normal message', async () => {
  const run = async (reread) => {
    let n = 0; const { el } = await mount(stayClient(() => ({ data: n++ === 0 ? STAY : { ...STAY, guest_count: reread, version: 9 }, error: null }), () => ({ data: { ok: true, guest_count: 3, version: 5, replay: true }, error: null })), GID);
    await clickA(el, 'stay-inc'); await clickA(el, 'stay-save'); await tick(); return el.html;
  };
  const moved = await run(1);
  assert.match(moved, /Your save went through earlier, and the number has since changed to 1 guest\. The card shows what is on file now\./); assert.doesNotMatch(moved, /Saved\. 3 guests/);
  assert.match(await run(2), /changed to 2 guests\./);
  const same = await run(3); assert.match(same, /Saved\. 3 guests\./); assert.doesNotMatch(same, /has since changed/);
});

test('G U4: a failed re-read after an unclear save says the save could not be confirmed, never that nothing changed', async () => {
  let reads = 0;
  const { el } = await mount(stayClient(() => (reads++ === 0 ? { data: STAY, error: null } : { data: null, error: { message: 'TypeError: Failed to fetch' } }), () => FAILED), GID);
  await clickA(el, 'stay-inc'); await clickA(el, 'stay-save'); await tick();
  assert.match(el.html, /The save could not be confirmed, and the card could not be read again\./); assert.doesNotMatch(el.html, /Nothing was changed|nothing changed/i);
  assert.equal(outN(el), 3, 'what you set stays');
});

// ------------------------------------------------------------------------------------------------ s120 U5: a redraw keeps what staff typed (one rule in G_paint), a late answer never closes an open form
const gateOf = () => { let release; const p = new Promise((r) => { release = r; }); return [p, release]; };
const caret = (el, id) => [el.fn[id].selectionStart, el.fn[id].selectionEnd];
const SAVED_OK = () => ({ data: { ok: true, guest_count: 3, version: 5 }, error: null });

test('G U5: the VIP tick keeps the note and the other fields typed so far', async () => {
  const { el } = await mount(detailClient(), GID);
  await clickA(el, 'edit'); el.type('G_f_phone', '0999 vip'); await clickA(el, 'vip'); await tick();
  assert.equal(el.val('G_f_phone'), '0999 vip'); assert.match(el.html, /G_f_vipr/); el.type('G_f_vipr', 'Friend of the owner');
  await clickA(el, 'vip'); await clickA(el, 'vip'); assert.equal(el.val('G_f_vipr'), 'Friend of the owner');
});

test('G U5: the unclear-save message states the number on file, never that the card shows it; the stepper keeps the number staff set', async () => {
  for (const [onFile, say] of [[2, /On file now: 2 guests\. If that is not what you set, tap Save again\./], [1, /On file now: 1 guest\. If that is not what you set, tap Save again\./]]) {
    let n = 0;
    const { el } = await mount(stayClient(() => ({ data: n++ === 0 ? STAY : { ...STAY, guest_count: onFile, version: 9 }, error: null }), () => FAILED), GID);
    await clickA(el, 'stay-inc'); await clickA(el, 'stay-save'); await tick();
    assert.match(el.html, /The save could not be confirmed\. On file now/); assert.match(el.html, say); assert.doesNotMatch(el.html, /card shows what is on file/); assert.equal(outN(el), 3, 'the stepper still shows what staff set');
  }
});

test('G U5: when the card re-read after a save shows a different stay, the page does not describe it as the one that was saved', async () => {
  const other = (c) => ({ ...STAY, uid: 'stay-uid-2', guest_count: c, version: 9 });
  const cases = { replay: () => ({ data: { ok: true, guest_count: 3, version: 5, replay: true }, error: null }), stale: () => ({ data: null, error: { code: '40001', message: 'stale version' } }), unclear: () => FAILED };
  for (const [name, set] of Object.entries(cases)) {
    let n = 0;
    const { el } = await mount(stayClient(() => ({ data: n++ === 0 ? STAY : other(1), error: null }), set), GID);
    await clickA(el, 'stay-inc'); await clickA(el, 'stay-save'); await tick();
    assert.match(el.html, /The card now shows a different stay from the one you changed\./, name); assert.doesNotMatch(el.html, /has since changed|It now shows|On file now|Saved\. /, name);
  }
});

test('G U3: the companion fallback is clamped to 3 on Today and on the card: the same input gives the same number', async () => {
  const names = ['Ana Maria Reyes', 'Bo Cruz', 'Cy Dela', 'Di Lim', 'Ed Tan'], { win } = load();
  const today = win.CS.goodToKnow({ guest_name: 'Ana Maria Reyes', companions: names.map((name) => ({ name })) }, true).guests;
  const comps = names.map((name, i) => ({ id: 'c' + i, guest_id: GID, name, id_type: null, id_number: null, id_photo_path: null }));
  const cl = detailClient({ rpcs: { list_guest_companions_v1: () => ({ data: comps, error: null }), staff_guest_stay_v1: () => ({ data: { ...STAY, guest_count: null, booked_guests: null }, error: null }) } });
  const { el } = await mount(cl, GID);
  assert.equal(today, 3); assert.equal(outN(el), today);
});

test('G U3: onChange fires once per save on success, replay and conflict, including when the person left mid-save', async () => {
  const answers = { success: () => ({ data: { ok: true, guest_count: 3, version: 5 }, error: null }), replay: () => ({ data: { ok: true, guest_count: 3, version: 5, replay: true }, error: null }), conflict: () => ({ data: null, error: { code: '40001', message: 'stale version' } }) };
  for (const [name, answer] of Object.entries(answers)) for (const leave of [false, true]) {
    let changed = 0, release; const gate = new Promise((r) => { release = r; });
    const { M, el } = await mount(stayClient(STAY, () => (leave ? gate.then(answer) : answer())), GID, 'owner', { onChange: () => changed++ });
    await clickA(el, 'stay-inc'); await clickA(el, 'stay-save');
    if (leave) { M.unmount(); release(); }
    await tick(); assert.equal(changed, 1, name + (leave ? ' after leaving' : ''));
  }
});

test('G U3: onChange also fires when the answer cannot prove nothing changed, and never for a definite refusal', async () => {
  const run = async (error) => { let changed = 0; const { el } = await mount(stayClient(STAY, () => ({ data: null, error })), GID, 'owner', { onChange: () => changed++ }); await clickA(el, 'stay-inc'); await clickA(el, 'stay-save'); await tick(); return changed; };
  for (const error of [{ code: '', message: 'Internal Server Error', status: 500 }, { message: 'TypeError: Failed to fetch', network: true }, { code: 'P0002', message: 'stay_not_found' }]) assert.equal(await run(error), 1, error.message);
  for (const code of ['42501', '22023', 'PGRST202']) assert.equal(await run({ code, message: 'x' }), 0, code);
});

test('G U3: 40001 says the stay was updated by someone else and shows the number it re-read, without claiming the count changed', async () => {
  for (const [count, say] of [[2, /It now shows 2 guests\./], [1, /It now shows 1 guest\./]]) {
    let n = 0;
    const { el } = await mount(stayClient(() => ({ data: n++ === 0 ? STAY : { ...STAY, guest_count: count, version: 9 }, error: null }), () => ({ data: null, error: { code: '40001', message: 'stale version' } })), GID);
    await clickA(el, 'stay-inc'); await clickA(el, 'stay-save'); await tick();
    assert.match(el.html, /This stay was updated by someone else\./); assert.match(el.html, say); assert.doesNotMatch(el.html, /changed the number|number of guests (was )?changed/);
  }
});

test('G U3: a 5xx, a gateway error or a dropped answer says the save could not be confirmed, reads the card again and keeps the key; only definite refusals say Nothing was changed', async () => {
  for (const error of [{ code: '', message: 'Internal Server Error', status: 500 }, { code: '', message: 'Bad Gateway' }, { code: 'XX000', message: 'boom' }, { code: '57014', message: 'canceling statement due to statement timeout' }, { message: 'TypeError: Failed to fetch', network: true }]) {
    const seen = [], cl = stayClient(STAY, (a) => { seen.push(plain(a)); return seen.length === 1 ? { data: null, error } : { data: { ok: true, guest_count: 3, version: 5 }, error: null }; });
    const { el } = await mount(cl, GID); await clickA(el, 'stay-inc'); await clickA(el, 'stay-save'); await tick();
    assert.match(el.html, /The save could not be confirmed\. On file now: 2 guests\. If that is not what you set, tap Save again\./, error.message); assert.doesNotMatch(el.html, /Nothing was changed/);
    assert.equal(cl.calls.filter((c) => c[0] === 'staff_guest_stay_v1').length, 2, 'the card was read again'); assert.equal(outN(el), 3, 'the number you set stays'); assert.match(el.html, /data-act="stay-save"/);
    await clickA(el, 'stay-save'); await tick();
    assert.equal(seen[1].p_idempotency_key, seen[0].p_idempotency_key, 'the retry keeps the key'); assert.equal(seen[1].p_expected_version, 4); assert.match(el.html, /Saved\. 3 guests\./);
  }
  let reads = 0; // the save did land and only the answer was lost: the re-read shows it
  const landed = await mount(stayClient(() => ({ data: reads++ === 0 ? STAY : { ...STAY, guest_count: 3, version: 5 }, error: null }), () => FAILED), GID);
  await clickA(landed.el, 'stay-inc'); await clickA(landed.el, 'stay-save'); await tick();
  assert.match(landed.el.html, /The save could not be confirmed\. On file now: 3 guests\./); assert.equal(outN(landed.el), 3); assert.doesNotMatch(landed.el.html, /data-act="stay-save"/);
  for (const [code, re] of [['42501', /not allowed to change this\. Nothing was changed\./], ['22023', /Choose 1, 2 or 3 guests\. Nothing was changed\./], ['PGRST202', /not available yet\. Nothing was changed\./]]) {
    const { el } = await mount(stayClient(STAY, () => ({ data: null, error: { code, message: 'x' } })), GID); await clickA(el, 'stay-inc'); await clickA(el, 'stay-save'); await tick();
    assert.match(el.html, re, code); assert.doesNotMatch(el.html, /could not be confirmed/);
  }
});

test('G U3: with no count and no booked number, Save is offered without a change so a count of 1 can be confirmed; a known count offers none', async () => {
  const cl = detailClient({ rpcs: { list_guest_companions_v1: () => ({ data: [COMPS[0]], error: null }), staff_guest_stay_v1: () => ({ data: { ...STAY, guest_count: null, booked_guests: null }, error: null }), set_stay_guest_count_v1: (a) => ({ data: { ok: true, guest_count: a.p_count, version: 5 }, error: null }) } });
  const { el } = await mount(cl, GID);
  assert.equal(outN(el), 1); assert.match(el.html, /data-act="stay-save"/); assert.doesNotMatch(el.html, /data-act="stay-undo"/, 'nothing to cancel yet');
  await clickA(el, 'stay-save'); await tick();
  const set = cl.calls.find((c) => c[0] === 'set_stay_guest_count_v1')[1]; assert.equal(set.p_count, 1); assert.equal(set.p_expected_version, 4);
  assert.match(el.html, /Saved\. 1 guest\./); assert.doesNotMatch(el.html, /data-act="stay-save"/);
  for (const stay of [STAY, { ...STAY, guest_count: null, booked_guests: 2 }, { ...STAY, guest_count: 1, booked_guests: null }]) assert.doesNotMatch((await mount(stayClient(stay), GID)).el.html, /data-act="stay-save"/);
});

test('G U3: a saved turn that arrives late turns the photos in place: no page redraw, so stepper focus and More details stay', async () => {
  let release; const gate = new Promise((r) => { release = r; }), cls = new Set(['G_r90']);
  const cl = rotDetail({ staff_guest_stay_v1: () => ({ data: STAY, error: null }), staff_photo_rotation_v1: () => gate.then(() => ({ data: [{ path: compPath, rotation: 180 }], error: null })) });
  const { el } = await mount(cl, GID);
  el.rotNodes = [{ getAttribute: (k) => (k === 'data-path' ? compPath : null), classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c) } }];
  const paints = el.paints; el.log.length = 0; release(); await tick();
  assert.equal(el.paints, paints, 'no whole-page repaint'); assert.deepEqual([...cls], ['G_r180']); assert.deepEqual(el.log, []);
});

// ------------------------------------------------------------------------------------------------ s120 U6: one write or reload at a time; nothing is queued, nothing can change underneath a save
// s120 U7: every control with that data-act (or data-pick) must be disabled, not any one of them; none drawn is not disabled either.
const tagsOf = (el, attr, v) => [...el.html.matchAll(new RegExp('<(?:button|a|label|input)\\b[^>]*\\b' + attr + '="' + v + '"[^>]*>', 'g'))].map((m) => m[0]);
const isOff = (t) => /\sdisabled(?=[\s>])/.test(t);
const dis = (el, act) => { const t = tagsOf(el, 'data-act', act); return t.length > 0 && t.every(isOff); };
const disPick = (el, pick) => { const t = tagsOf(el, 'data-pick', pick); return t.length > 0 && t.every(isOff); };
const ena = (el, act) => { const t = tagsOf(el, 'data-act', act); return t.length > 0 && t.every((x) => !isOff(x)); };
const nCalls = (cl, name) => cl.calls.filter((c) => c[0] === name).length;
const nFn = (cl, action) => cl.fcalls.filter((c) => c[1].action === action).length;
const FETCH_ERR = { data: null, error: { message: 'TypeError: Failed to fetch' } };
const PROPOSAL = { phone: '09175550000', email: null, guests: 2, nationality: null, stay_preferences: 'Allergic to nuts', birthday: '1992-03-04', tags: ['anniversary'], companions: ['Carla Dizon'], ids: [], images: [] };
const addClient = (onSave) => { let saves = 0; return detailClient({ fn: (b) => (b.action === 'context' ? { status: 200, j: { ok: true, features: FEAT } } : b.action === 'extract' ? { status: 200, j: { ok: true, proposal: PROPOSAL } } : onSave(saves++, b)) }); };
const toReview = async (cl) => { const m = await mount(cl, GID); await clickA(m.el, 'add-open'); m.el.type('G_text', 'Hi, allergic to nuts'); await clickA(m.el, 'read'); await tick(); assert.match(m.el.html, /Check before saving/); return m; };

test('G U6: while a count save runs, a reload and a second count save are refused and nothing is queued; both work again afterwards', async () => {
  const [gate, release] = gateOf();
  const cl = detailClient({ rpcs: { list_guest_companions_v1: () => FETCH_ERR, staff_guest_stay_v1: () => ({ data: STAY, error: null }), set_stay_guest_count_v1: () => gate.then(SAVED_OK) } });
  const { el } = await mount(cl, GID);
  assert.match(el.html, /data-act="detail-retry"/);
  await clickA(el, 'stay-inc'); await clickA(el, 'stay-save'); await tick();
  assert.ok(dis(el, 'stay-save') && dis(el, 'detail-retry') && dis(el, 'edit') && dis(el, 'add-open'), 'every control that would start another is disabled');
  await clickA(el, 'detail-retry'); await clickA(el, 'stay-save'); await clickA(el, 'edit'); await tick();
  assert.equal(nCalls(cl, 'list_guest_companions_v1'), 1); assert.equal(nCalls(cl, 'staff_guest_stay_v1'), 1); assert.equal(nCalls(cl, 'set_stay_guest_count_v1'), 1); assert.doesNotMatch(el.html, /G_f_phone/);
  release(); await tick();
  assert.equal(nCalls(cl, 'set_stay_guest_count_v1'), 1, 'nothing was queued'); assert.equal(nCalls(cl, 'list_guest_companions_v1'), 1);
  assert.match(el.html, /Saved\. 3 guests\./); assert.ok(!dis(el, 'detail-retry') && !dis(el, 'edit'));
  await clickA(el, 'detail-retry'); await tick(); assert.equal(nCalls(cl, 'list_guest_companions_v1'), 2);
});

test('G U6: with Edit details or Add from text open, photo removal, a companion change, a photo replace and a reload are refused', async () => {
  for (const open of ['edit', 'add-open']) {
    const cl = detailClient(), { M, el } = await mount(cl, GID);
    await clickA(el, open); await tick();
    for (const a of ['remove-photo', 'remove-photo-yes', 'remove-comp', 'remove-comp-yes', 'detail-retry', 'full-rot']) await clickA(el, a, { id: CID });
    await el.l.change[0]({ target: { getAttribute: (k) => ({ 'data-pick': 'replace', 'data-id': CID })[k] ?? null, files: [{}], value: '' } }); assert.equal(M._state().cbusy, '', open + ': the pick did not start'); await tick();
    assert.equal(nFn(cl, 'remove_id'), 0, open); assert.equal(nFn(cl, 'replace_id'), 0, open); assert.equal(nCalls(cl, 'delete_guest_companion_v1'), 0, open);
    assert.equal(nCalls(cl, 'list_guest_companions_v1'), 1, open + ': no reload'); assert.equal(M._state().confirm, null, open); assert.equal(M._state().cbusy, '', open);
  }
});

test('G U6: while a photo removal runs, Edit details, Add from text and a second removal are refused; the page reloads once and then works', async () => {
  const [gate, release] = gateOf(); let flag = true;
  const cl = detailClient({ tables: { guests: { data: GUEST, error: null }, guest_profile_details: () => ({ data: { ...PROFILE, id_on_file: flag }, error: null }) },
    rpcs: { list_guest_companions_v1: () => ({ data: flag ? COMPS : COMPS.map((c) => ({ ...c, id_photo_path: null })), error: null }) },
    fn: (b) => (b.action === 'context' ? { status: 200, j: { ok: true, features: FEAT } } : gate.then(() => { flag = false; return { data: { ok: true, saved: [{ what: 'id_photo_removed', ok: true }, { what: 'profile', ok: true }] }, error: null }; })) });
  const { el } = await mount(cl, GID);
  await clickA(el, 'remove-photo', { id: CID }); await clickA(el, 'remove-photo-yes', { id: CID }); await tick();
  assert.ok(dis(el, 'edit') && dis(el, 'add-open'));
  await clickA(el, 'edit'); await clickA(el, 'add-open'); await clickA(el, 'remove-photo-yes', { id: CID }); await clickA(el, 'remove-comp-yes', { id: CID2 }); await tick();
  assert.doesNotMatch(el.html, /G_f_phone|G_text/); assert.equal(nFn(cl, 'remove_id'), 1); assert.equal(nCalls(cl, 'delete_guest_companion_v1'), 0);
  release(); await tick();
  assert.match(el.html, /ID photo removed/); assert.match(el.html, /No ID yet/); assert.doesNotMatch(el.html, / disabled[ >]/);
  await clickA(el, 'edit'); await tick(); assert.match(el.html, /G_f_phone/);
});

test('G U6: while Add from text saves, a second Save, Back and Cancel do nothing, and the fields cannot take text; a failure unlocks them with the text intact', async () => {
  const [gate, release] = gateOf();
  const cl = addClient((n) => (n === 0 ? gate.then(() => ({ data: null, error: { context: { status: 500, json: () => Promise.resolve({ error: 'save_failed' }) } } })) : { status: 200, j: { ok: true, saved: [{ what: 'profile', ok: true }] } }));
  const { M, el } = await toReview(cl);
  el.type('G_r_pref', 'Allergic to nuts and shellfish'); await clickA(el, 'save-add'); await tick();
  assert.match(el.html, /id="G_r_phone"[^>]*\sreadonly/); assert.match(el.html, /id="G_r_pref"[^>]*\sreadonly/); assert.match(el.html, /id="G_r_reason"[^>]*\sreadonly/); assert.match(el.html, /data-act="comp-on"[^>]*\sdisabled/);
  assert.ok(dis(el, 'save-add') && dis(el, 'add-back'));
  await clickA(el, 'save-add'); await clickA(el, 'add-back'); await clickA(el, 'add-cancel'); await clickA(el, 'comp-on', { i: 0 }); await tick();
  assert.equal(nFn(cl, 'save'), 1); assert.equal(M._state().add.step, 'saving'); assert.equal(M._state().add.sheet.companions[0].on, true);
  release(); await tick();
  assert.match(el.html, /Check before saving/); assert.doesNotMatch(el.html, /\sreadonly/); assert.equal(el.val('G_r_pref'), 'Allergic to nuts and shellfish');
  await clickA(el, 'save-add'); await tick();
  assert.equal(nFn(cl, 'save'), 2); assert.equal(cl.fcalls.filter((c) => c[1].action === 'save').pop()[1].stay_preferences, '2026-10-14: Allergic to nuts and shellfish'); assert.match(el.html, /Details saved\./);
});

test('G U6: while Edit details saves, its fields and the VIP tick are read-only, Cancel and a second Save do nothing; a failure unlocks them with the text intact', async () => {
  const [gate, release] = gateOf(); let n = 0;
  const cl = detailClient({ rpcs: { list_guest_companions_v1: () => ({ data: COMPS, error: null }), save_guest_profile_v1: () => (n++ === 0 ? gate.then(() => ({ data: null, error: { code: '42501', message: 'permission denied' } })) : { data: { ok: true, version: 5 }, error: null }) } });
  const { M, el } = await mount(cl, GID);
  await clickA(el, 'edit'); el.type('G_f_phone', '0999 typed'); await clickA(el, 'save-edit'); await tick();
  for (const id of ['G_f_phone', 'G_f_bday', 'G_f_tags', 'G_f_reason']) assert.match(el.html, new RegExp('id="' + id + '"[^>]*\\sreadonly'), id);
  assert.match(el.html, /data-act="vip"[^>]*\sdisabled/); assert.ok(dis(el, 'save-edit') && dis(el, 'edit-cancel'));
  await clickA(el, 'save-edit'); await clickA(el, 'edit-cancel'); await clickA(el, 'vip'); await tick();
  assert.equal(nCalls(cl, 'save_guest_profile_v1'), 1); assert.ok(M._state().edit, 'Cancel did nothing'); assert.equal(M._state().edit.vip, false);
  release(); await tick();
  assert.doesNotMatch(el.html, /\sreadonly/); assert.equal(el.val('G_f_phone'), '0999 typed'); assert.match(el.html, /not allowed|permission/i);
  await clickA(el, 'save-edit'); await tick(); assert.equal(nCalls(cl, 'save_guest_profile_v1'), 2); assert.match(el.html, /Saved\. Changed/);
});

test('G U6: the running state clears after success, a failure and a thrown error, so the page is never stuck', async () => {
  const modes = { ok: () => ({ data: { ok: true, version: 5 }, error: null }), refused: () => ({ data: null, error: { code: '42501', message: 'permission denied' } }), thrown: () => { throw new Error('boom'); } };
  for (const [name, h] of Object.entries(modes)) { // Edit details
    const cl = detailClient({ rpcs: { list_guest_companions_v1: () => ({ data: COMPS, error: null }), save_guest_profile_v1: h } }), { M, el } = await mount(cl, GID);
    await clickA(el, 'edit'); el.type('G_f_phone', '0999 ' + name); await clickA(el, 'save-edit'); await tick();
    assert.equal(M._state().busy, false, 'edit ' + name);
    if (name === 'thrown') { assert.ok(dis(el, 'save-edit'), 'a lost answer locks Save (stale), it is not stuck busy'); await clickA(el, 'edit-cancel'); await tick(); assert.doesNotMatch(el.html, / disabled[ >]/, 'Cancel reloads and frees the page'); continue; }
    assert.doesNotMatch(el.html, / disabled[ >]/, 'edit ' + name);
    if (name === 'ok') { await clickA(el, 'edit'); await tick(); assert.match(el.html, /G_f_phone/); }
  }
  const stays = { ok: SAVED_OK, refused: () => ({ data: null, error: { code: '42501', message: 'permission denied' } }), unclear: () => FAILED, thrown: () => { throw new Error('boom'); } };
  for (const [name, h] of Object.entries(stays)) { // count save
    const cl = stayClient(STAY, h), { el } = await mount(cl, GID);
    await clickA(el, 'stay-inc'); await clickA(el, 'stay-save'); await tick();
    assert.doesNotMatch(el.html, / disabled[ >]/, 'count ' + name); await clickA(el, 'edit'); await tick(); assert.match(el.html, /G_f_phone/, 'count ' + name);
  }
  const companions = { added: () => ({ data: { ok: true, id: 'new' }, error: null }), thrown: () => { throw new Error('boom'); } };
  for (const [name, h] of Object.entries(companions)) { // companion add
    const cl = detailClient({ rpcs: { list_guest_companions_v1: () => ({ data: COMPS, error: null }), save_guest_companion_v1: h } }), { M, el } = await mount(cl, GID);
    await clickA(el, 'comp-add-open'); el.type('G_newc', 'Dino Lim'); await clickA(el, 'add-comp'); await tick();
    assert.equal(M._state().cbusy, '', name); assert.doesNotMatch(el.html, / disabled[ >]/, 'add ' + name);
  }
  const cl = detailClient({ fn: (b) => { if (b.action === 'context') return { status: 200, j: { ok: true, features: FEAT } }; throw new Error('boom'); } }), { M, el } = await mount(cl, GID); // photo removal
  await clickA(el, 'remove-photo', { id: CID }); await clickA(el, 'remove-photo-yes', { id: CID }); await tick();
  assert.equal(M._state().cbusy, ''); assert.doesNotMatch(el.html, / disabled[ >]/); assert.match(el.html, /The connection dropped, so this may have saved/); // a thrown call has no HTTP status
});

test('G U6: the saved stay is gone and the card re-read is a different stay: the page says so, and the card shows the next stay', async () => {
  let n = 0;
  const { el } = await mount(stayClient(() => ({ data: n++ === 0 ? STAY : { ...STAY, uid: 'stay-uid-2', checkin_date: '2026-11-02', checkout_date: '2026-11-04', guest_count: 1, version: 7 }, error: null }), () => ({ data: null, error: { code: 'P0002', message: 'stay_not_found' } })), GID);
  await clickA(el, 'stay-inc'); await clickA(el, 'stay-save'); await tick();
  assert.match(el.html, /The stay you changed is no longer on the calendar\. This card now shows the next stay\./); assert.doesNotMatch(el.html, />This stay is no longer on the calendar/); assert.equal(outN(el), 1); assert.match(el.html, />Next stay</);
});

test('G U6: a cleared Reason on the review sheet stays cleared when the sheet is redrawn; the blank still sends the default reason', async () => {
  const cl = addClient(() => ({ status: 200, j: { ok: true, saved: [{ what: 'profile', ok: true }] } })), { el } = await toReview(cl);
  assert.equal(el.val('G_r_reason'), 'Updated in the Staff app');
  el.type('G_r_reason', ''); await clickA(el, 'comp-on', { i: 0 }); await tick();
  assert.equal(el.val('G_r_reason'), '', 'the redraw did not put the default back');
  await clickA(el, 'save-add'); await tick();
  assert.equal(cl.fcalls.filter((c) => c[1].action === 'save').pop()[1].reason, 'Updated in the Staff app');
});

test('G U6: the typed companion name is kept across a redraw and a failed add, read-only while it saves, and cleared only after a successful add', async () => {
  let n = 0; const [gate, release] = gateOf();
  const cl = detailClient({ rpcs: { list_guest_companions_v1: () => ({ data: COMPS, error: null }), save_guest_companion_v1: () => (n++ === 0 ? gate.then(() => ({ data: null, error: { code: '42501', message: 'permission denied' } })) : { data: { ok: true, id: 'new' }, error: null }) } });
  const { el } = await mount(cl, GID);
  await clickA(el, 'comp-add-open'); el.type('G_newc', 'Dino Lim');
  await clickA(el, 'comp-open', { id: CID2 }); assert.equal(el.val('G_newc'), 'Dino Lim', 'a redraw keeps it');
  await clickA(el, 'add-comp'); await tick(); assert.match(el.html, /id="G_newc"[^>]*\sreadonly/); assert.ok(dis(el, 'add-comp'));
  release(); await tick();
  assert.equal(el.val('G_newc'), 'Dino Lim', 'a failed add keeps it'); assert.doesNotMatch(el.html, /id="G_newc"[^>]*\sreadonly/);
  await clickA(el, 'add-comp'); await tick();
  assert.match(el.html, /Dino Lim was added\./); assert.doesNotMatch(el.html, /G_newc/);
  await clickA(el, 'comp-add-open'); assert.equal(el.val('G_newc'), '', 'cleared after the successful add');
});

test('G U6: a late answer puts focus on its message box when no field is active, and never pulls it off a field staff are typing in', async () => {
  const a = await mount(stayClient(STAY, SAVED_OK), GID);
  await clickA(a.el, 'stay-inc'); await clickA(a.el, 'stay-save'); await tick();
  assert.ok(a.el.focuslog.includes('G_stmsg'), 'the message box took focus');
  const [gate, release] = gateOf();
  const { el } = await mount(detailClient({ fn: (b) => (b.action === 'context' ? { status: 200, j: { ok: true, features: FEAT } } : gate.then(() => ({ data: null, error: { context: { status: 400, json: () => Promise.resolve({ error: 'read_failed' }) } } }))) }), GID);
  await clickA(el, 'add-open'); el.type('G_text', 'Hi there', 3); await clickA(el, 'read'); await tick();
  el.type('G_text', 'Hi there, two guests', 5); release(); await tick();
  assert.match(el.html, /could not be read/); assert.equal(el.active, 'G_text'); assert.ok(!el.focuslog.includes('G_aerr'), 'focus stayed on the field');
});

test('G U6: a photo that cannot be read ends the replace and unlocks the page; a late tap while the page reloads does nothing', async () => {
  const cl = detailClient(), { M, el } = await mount(cl, GID);
  await el.l.change[0]({ target: { getAttribute: (k) => ({ 'data-pick': 'replace', 'data-id': CID })[k] ?? null, files: [{}], value: '' } });
  assert.equal(M._state().cbusy, CID, 'the replace is running'); assert.ok(dis(el, 'edit'));
  await tick(); assert.equal(M._state().cbusy, ''); assert.match(el.html, /not a photo we can use/); assert.doesNotMatch(el.html, / disabled[ >]/);
  const [gate, release] = gateOf(); let flag = true, n = 0;
  const c2 = detailClient({ tables: { guests: { data: GUEST, error: null }, guest_profile_details: () => (n++ === 0 ? { data: PROFILE, error: null } : gate.then(() => ({ data: { ...PROFILE, id_on_file: flag }, error: null }))) },
    fn: (b) => (b.action === 'context' ? { status: 200, j: { ok: true, features: FEAT } } : { status: 200, j: { ok: true, saved: [{ what: 'id_photo_removed', ok: true }, { what: 'profile', ok: true }] } }) });
  const m2 = await mount(c2, GID);
  await clickA(m2.el, 'remove-photo', { id: CID }); await clickA(m2.el, 'remove-photo-yes', { id: CID }); await tick();
  assert.equal(m2.M._state().d.loading, true, 'the page is reloading'); await clickA(m2.el, 'edit'); await clickA(m2.el, 'add-open'); await clickA(m2.el, 'remove-photo-yes', { id: CID2 });
  assert.equal(m2.M._state().edit, null); assert.equal(m2.M._state().add, null); assert.equal(nFn(c2, 'remove_id'), 1);
  release(); await tick(); assert.match(m2.el.html, /ID photo removed/);
});

test('G U6: Rotate is disabled and does nothing while a count save runs', async () => {
  const [gate, release] = gateOf();
  const cl = rotDetail({ staff_guest_stay_v1: () => ({ data: STAY, error: null }), set_stay_guest_count_v1: () => gate.then(SAVED_OK), set_guest_photo_rotation_v1: (a) => ({ data: { ok: true, path: a.p_path, rotation: a.p_rotation }, error: null }) });
  const { el } = await mount(cl, GID); await tick();
  await clickA(el, 'show-id', { id: CID }); await tick();
  await clickA(el, 'stay-inc'); await clickA(el, 'stay-save'); await tick();
  await clickA(el, 'full', { id: CID }); await tick();
  assert.ok(dis(el, 'full-rot')); await clickA(el, 'full-rot'); await new Promise((r) => setTimeout(r, 700));
  assert.equal(nCalls(cl, 'set_guest_photo_rotation_v1'), 0); release(); await tick();
});

// ------------------------------------------------------------------------------------------------ s120 U7: the fixes that protect data
// The real client's dropped answer is { error: { message: 'TypeError: Failed to fetch' } }: no HTTP status, no database code, no `network` flag. New tests use that shape only.
const LOSTRE = /The connection dropped, so this may have saved\. Check the page before trying again\./;
const COPYRE = /Copy anything you need, then tap Cancel to see the latest details\./;
const LOSTFN = () => Promise.resolve({ data: null, error: { message: 'TypeError: Failed to fetch' } });
const IMG = (b64 = 'QUJD') => ({ base64: b64, mime: 'image/jpeg', src: 'data:image/jpeg;base64,' + b64 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pickEv = (pick, id) => ({ target: { getAttribute: (k) => ({ 'data-pick': pick, 'data-id': id })[k] ?? null, files: [{}], value: 'x' } });
const offline = (win) => Object.defineProperty(win, 'navigator', { configurable: true, value: { onLine: false } });
function withImage(win) { // opt in: the page can shrink a photo, and the test decides when
  const imgs = [];
  Object.defineProperty(win, 'Image', { configurable: true, value: class { set src(v) { imgs.push(this); } } });
  Object.defineProperty(win, 'document', { configurable: true, value: { createElement: () => ({ getContext: () => ({ fillRect() {}, drawImage() {} }), toDataURL: () => 'data:image/jpeg;base64,QUJD' }) } });
  return { fire: () => imgs.splice(0).forEach((i) => { i.naturalWidth = 800; i.naturalHeight = 600; i.onload(); }) };
}
const CTX = { status: 200, j: { ok: true, features: FEAT } };
const IDS_PROPOSAL = { ...PROPOSAL, ids: [{ image: 1, name: 'Ben Cruz', id_type: 'passport', own: false }] }; // the ID belongs to the SECOND photo
const reviewClient = (onSave, proposal = IDS_PROPOSAL, extra = {}) => detailClient({ fn: (b) => (b.action === 'context' ? CTX : b.action === 'extract' ? { status: 200, j: { ok: true, proposal } } : onSave(b)), ...extra });
const toReviewWith = async (cl, imgs = [IMG('QUFB'), IMG('REVG')]) => { const m = await mount(cl, GID); await clickA(m.el, 'add-open'); m.M._state().add.images.push(...imgs); m.el.type('G_text', 'Hi, Ben Cruz is with me'); await clickA(m.el, 'read'); await tick(); assert.match(m.el.html, /Check before saving/); return m; };

test('G U7: while Add from text reads, photo Remove and both pickers are disabled and refused, so the ID stays with the right person', async () => {
  const [gate, release] = gateOf(), saves = [];
  const cl = detailClient({ fn: (b) => (b.action === 'context' ? CTX : b.action === 'extract' ? gate.then(() => ({ data: { ok: true, proposal: IDS_PROPOSAL }, error: null })) : (saves.push(b), { status: 200, j: { ok: true, saved: [{ what: 'profile', ok: true }, { what: 'id_photo', ok: true }] } })) });
  const { M, el } = await mount(cl, GID);
  await clickA(el, 'add-open'); M._state().add.images.push(IMG('QUFB'), IMG('REVG')); el.type('G_text', 'Hi'); await clickA(el, 'read'); await tick();
  assert.equal(M._state().add.step, 'reading'); assert.equal(tagsOf(el, 'data-act', 'rm-shot').length, 2); assert.ok(dis(el, 'rm-shot'), 'every Remove is disabled'); assert.equal(tagsOf(el, 'data-pick', 'shot').length, 2); assert.ok(disPick(el, 'shot'), 'both pickers are disabled');
  await clickA(el, 'rm-shot', { i: 0 }); await el.l.change[0](pickEv('shot')); await tick();
  assert.equal(M._state().add.images.length, 2, 'Remove did nothing'); assert.equal(M._state().add.preparing, 0, 'the pick did not start'); assert.equal(M._state().add.err, '');
  release(); await tick(); assert.match(el.html, /Check before saving/);
  await clickA(el, 'save-add'); await tick();
  assert.equal(saves.length, 1); assert.deepEqual(saves[0].ids.map((d) => [d.name, d.image.base64]), [['Ben Cruz', 'REVG']], 'the ID is still the second photo and still Ben Cruz');
});

test('G U7: while Add from text saves, a late photo pick does nothing', async () => {
  const [gate, release] = gateOf();
  const { M, el } = await toReviewWith(reviewClient(() => gate.then(() => ({ data: { ok: true, saved: [{ what: 'profile', ok: true }] }, error: null }))));
  await clickA(el, 'save-add'); await tick(); assert.equal(M._state().add.step, 'saving');
  await el.l.change[0](pickEv('shot')); await tick(); assert.equal(M._state().add.preparing, 0); assert.equal(M._state().add.images.length, 2);
  release(); await tick();
});

// ---- rotation counts as a write
const rotOpen = async (cl) => { const m = await mount(cl, GID); await tick(); await clickA(m.el, 'show-id', { id: CID }); await tick(); await clickA(m.el, 'full', { id: CID }); await tick(); return m; };
const rotCl = (set) => rotDetail({ staff_guest_stay_v1: () => ({ data: STAY, error: null }), set_guest_photo_rotation_v1: set });

test('G U7: Rotate is a write from the tap: quick taps merge into one call, a tap while the call is out is refused, and two calls are never in flight', async () => {
  const [gate, release] = gateOf(); let inflight = 0, max = 0; const sent = [];
  const cl = rotCl((a) => { sent.push(a.p_rotation); inflight++; max = Math.max(max, inflight); return gate.then(() => { inflight--; return { data: { ok: true, path: a.p_path, rotation: a.p_rotation }, error: null }; }); });
  const { M, el } = await rotOpen(cl);
  await clickA(el, 'full-rot'); await clickA(el, 'full-rot'); await tick();
  assert.equal(M._state().rot, 1, 'waiting to send'); assert.ok(dis(el, 'edit') && dis(el, 'add-open') && dis(el, 'remove-photo'), 'the wait already counts as a write'); assert.ok(ena(el, 'full-rot'), 'Rotate itself still takes a merging tap');
  await clickA(el, 'edit'); assert.equal(M._state().edit, null, 'Edit details does nothing during the wait');
  await sleep(700); assert.equal(M._state().rot, 2, 'the call is out'); assert.deepEqual(sent, [180], 'two taps made one call'); assert.ok(dis(el, 'full-rot'));
  await clickA(el, 'full-rot'); await sleep(700); assert.deepEqual(sent, [180], 'a tap while the call is out sends nothing'); assert.equal(max, 1);
  release(); await tick(); assert.ok(!M._state().rot); assert.ok(ena(el, 'full-rot') && ena(el, 'edit'));
  await clickA(el, 'full-rot'); await sleep(700); await tick(); assert.deepEqual(sent, [180, 270], 'the refused tap was not turned, so the next one is 270'); assert.equal(max, 1, 'never two in flight');
});

test('G U7: the rotation flag clears after a refusal, a lost answer and a thrown error, and when the page is left', async () => {
  for (const [name, h] of Object.entries({ refused: () => ({ data: null, error: { code: '42501', message: 'x' } }), lost: LOSTFN, thrown: () => { throw new Error('boom'); } })) {
    const { M, el } = await rotOpen(rotCl(h)); await clickA(el, 'full-rot'); await sleep(700); await tick();
    assert.ok(!M._state().rot, name); assert.ok(ena(el, 'edit') && ena(el, 'full-rot'), name); assert.match(el.html, /Could not save/, name);
  }
  const a = await rotOpen(rotCl(() => ({ data: { ok: true }, error: null }))); await clickA(a.el, 'full-rot'); assert.equal(a.M._state().rot, 1);
  a.M.unmount(); const b = await rotOpen(rotCl(() => ({ data: { ok: true }, error: null })));
  assert.ok(!b.M._state().rot, 'a new page starts clear'); assert.ok(ena(b.el, 'edit') && ena(b.el, 'full-rot')); await sleep(700);
});

// ---- a lost answer is not "nothing changed"
test('G U7: a lost answer to Save details locks Save, keeps the typed text, says what to do, and Cancel reloads the page', async () => {
  const cl = detailClient({ rpcs: { list_guest_companions_v1: () => ({ data: COMPS, error: null }), save_guest_profile_v1: () => FETCH_ERR } });
  const { M, el } = await mount(cl, GID);
  await clickA(el, 'edit'); el.type('G_f_phone', '0999 typed'); await clickA(el, 'save-edit'); await tick();
  assert.match(el.html, LOSTRE); assert.match(el.html, COPYRE); assert.ok(M._state().d.stale); assert.ok(dis(el, 'save-edit')); assert.ok(ena(el, 'edit-cancel')); assert.equal(el.val('G_f_phone'), '0999 typed', 'the text stays');
  await clickA(el, 'save-edit'); await tick(); assert.equal(nCalls(cl, 'save_guest_profile_v1'), 1, 'a locked Save sends nothing');
  await clickA(el, 'edit-cancel'); await tick();
  assert.equal(nCalls(cl, 'list_guest_companions_v1'), 2, 'Cancel reloaded the page'); assert.doesNotMatch(el.html, /G_f_phone/); assert.ok(!M._state().d.stale); assert.doesNotMatch(el.html, / disabled[ >]/);
});

test('G U7: a version conflict while editing locks Save the same way and keeps the text; Cancel reloads', async () => {
  const cl = detailClient({ rpcs: { list_guest_companions_v1: () => ({ data: COMPS, error: null }), save_guest_profile_v1: () => ({ data: null, error: { code: '40001', message: 'stale version' } }) } });
  const { el } = await mount(cl, GID);
  await clickA(el, 'edit'); el.type('G_f_phone', '0999 typed'); await clickA(el, 'save-edit'); await tick();
  assert.match(el.html, /Someone else changed this guest\./); assert.match(el.html, COPYRE); assert.ok(dis(el, 'save-edit')); assert.equal(el.val('G_f_phone'), '0999 typed');
  await clickA(el, 'edit-cancel'); await tick(); assert.equal(nCalls(cl, 'list_guest_companions_v1'), 2); assert.ok(ena(el, 'edit'));
});

test('G U7: offline for certain (navigator.onLine false) is still "nothing was sent": no lock, the form stays usable', async () => {
  const cl = detailClient({ rpcs: { list_guest_companions_v1: () => ({ data: COMPS, error: null }), save_guest_profile_v1: () => FETCH_ERR } });
  const { M, el, win } = await mount(cl, GID); offline(win);
  await clickA(el, 'edit'); el.type('G_f_phone', '0999 typed'); await clickA(el, 'save-edit'); await tick();
  assert.match(el.html, /No connection, so nothing was sent/); assert.doesNotMatch(el.html, LOSTRE); assert.ok(!M._state().d.stale); assert.ok(ena(el, 'save-edit'));
  const c2 = detailClient({ fn: (b) => (b.action === 'context' ? CTX : LOSTFN()) }), m2 = await mount(c2, GID); offline(m2.win);
  await clickA(m2.el, 'remove-photo', { id: CID }); await clickA(m2.el, 'remove-photo-yes', { id: CID }); await tick();
  assert.match(m2.el.html, /No connection/); assert.doesNotMatch(m2.el.html, LOSTRE); assert.equal(nFn(c2, 'context'), 1, 'no reload'); assert.equal(m2.M._state().cbusy, '');
});

test('G U7: a lost answer to Add a companion re-reads the people: the name there clears the field, the name missing keeps it', async () => {
  for (const landed of [true, false]) {
    let reads = 0; const NEW = { id: 'n1', guest_id: GID, name: 'Dino Lim', id_type: null, id_number: null, id_photo_path: null };
    const cl = detailClient({ rpcs: { list_guest_companions_v1: () => ({ data: reads++ === 0 || !landed ? COMPS : [...COMPS, NEW], error: null }), save_guest_companion_v1: () => FETCH_ERR } });
    const { M, el } = await mount(cl, GID); await clickA(el, 'comp-add-open'); el.type('G_newc', 'Dino Lim'); await clickA(el, 'add-comp'); await tick();
    assert.equal(nCalls(cl, 'list_guest_companions_v1'), 2, 'the people were read again'); assert.equal(M._state().cbusy, '');
    if (landed) { assert.match(el.html, /Dino Lim was added\./); assert.doesNotMatch(el.html, /id="G_newc"/); assert.equal(M._state().newc, ''); assert.doesNotMatch(el.html, LOSTRE); }
    else { assert.equal(el.val('G_newc'), 'Dino Lim', 'kept'); assert.match(el.html, LOSTRE); assert.doesNotMatch(el.html, / disabled[ >]/); }
  }
});

test('G U7: Remove person: a refusal unlocks, a lost answer reloads at once and keeps the sentence, and a success says so', async () => {
  let mode = 'refused';
  const cl = detailClient({ rpcs: { list_guest_companions_v1: () => ({ data: COMPS, error: null }), delete_guest_companion_v1: () => (mode === 'refused' ? { data: null, error: { code: '42501', message: 'permission denied' } } : mode === 'lost' ? FETCH_ERR : { data: { ok: true }, error: null }) } });
  const { M, el } = await mount(cl, GID);
  await clickA(el, 'remove-comp', { id: CID2 }); await clickA(el, 'remove-comp-yes', { id: CID2 }); await tick();
  assert.equal(M._state().cbusy, ''); assert.doesNotMatch(el.html, / disabled[ >]/); assert.match(el.html, /not allowed|permission/i); assert.equal(nCalls(cl, 'list_guest_companions_v1'), 1, 'a refusal does not reload');
  mode = 'lost'; await clickA(el, 'remove-comp', { id: CID2 }); await clickA(el, 'remove-comp-yes', { id: CID2 }); await tick();
  assert.equal(nCalls(cl, 'list_guest_companions_v1'), 2, 'reloaded at once'); assert.match(el.html, LOSTRE); assert.doesNotMatch(el.html, / disabled[ >]/);
  mode = 'ok'; await clickA(el, 'remove-comp', { id: CID2 }); await clickA(el, 'remove-comp-yes', { id: CID2 }); await tick(); assert.match(el.html, /The person was removed/);
});

test('G U7: Remove photo: a lost answer reloads at once and keeps the sentence; companion_not_found does the same with its own sentence', async () => {
  for (const [r, say] of [[LOSTFN, LOSTRE], [() => ({ status: 404, j: { error: 'companion_not_found' } }), /no longer on this guest/]]) {
    const cl = detailClient({ fn: (b) => (b.action === 'context' ? CTX : r()) }), { M, el } = await mount(cl, GID);
    await clickA(el, 'remove-photo', { id: CID }); await clickA(el, 'remove-photo-yes', { id: CID }); await tick();
    assert.equal(nFn(cl, 'context'), 2, 'reloaded at once'); assert.match(el.html, say); assert.equal(M._state().cbusy, ''); assert.doesNotMatch(el.html, / disabled[ >]/);
  }
});

test('G U7: a lost answer to Replace photo reloads at once and keeps the sentence; a 207 with the photo saved re-reads the people', async () => {
  const a = await mount(detailClient({ fn: (b) => (b.action === 'context' ? CTX : LOSTFN()) }), GID), ia = withImage(a.win);
  await a.el.l.change[0](pickEv('replace', CID)); ia.fire(); await tick();
  assert.match(a.el.html, LOSTRE); assert.equal(a.M._state().cbusy, '');
  const cl = detailClient({ fn: (b) => (b.action === 'context' ? CTX : { status: 207, j: { ok: false, saved: [{ what: 'id_photo', ok: true }, { what: 'profile', ok: false, reason: 'save_failed' }] } }) }), b = await mount(cl, GID), ib = withImage(b.win);
  await b.el.l.change[0](pickEv('replace', CID)); ib.fire(); await tick();
  assert.equal(nCalls(cl, 'list_guest_companions_v1'), 2, 'the list was read again'); assert.equal(b.M._state().cbusy, ''); assert.match(b.el.html, /ID photo saved\./); assert.match(b.el.html, /The details did not save/);
  const c = detailClient({ fn: (x) => (x.action === 'context' ? CTX : { status: 207, j: { ok: false, saved: [{ what: 'id_photo', ok: false, reason: 'upload_failed' }] } }) }), d = await mount(c, GID), id = withImage(d.win);
  await d.el.l.change[0](pickEv('replace', CID)); id.fire(); await tick(); assert.equal(nCalls(c, 'list_guest_companions_v1'), 1, 'nothing saved, so no re-read'); assert.equal(d.M._state().cbusy, '');
});

test('G U7: leaving the page while a replacement photo is being prepared sends nothing', async () => {
  const cl = detailClient(), m = await mount(cl, GID), im = withImage(m.win);
  await m.el.l.change[0](pickEv('replace', CID)); assert.equal(m.M._state().cbusy, CID);
  m.M.unmount(); const cl2 = detailClient(), m2 = await mount(cl2, '0a1b2c3d-0000-4000-8000-000000000002'); im.fire(); await tick();
  assert.equal(nFn(cl, 'replace_id'), 0); assert.equal(nFn(cl2, 'replace_id'), 0, 'nor against the guest now open'); assert.equal(m2.M._state().cbusy, '');
});

test('G U7: a lost answer to Add from text save keeps the sheet and photos, locks Save, and Cancel reloads the guest', async () => {
  const cl = reviewClient(() => LOSTFN()), { M, el } = await toReviewWith(cl);
  el.type('G_r_pref', 'Typed note'); await clickA(el, 'save-add'); await tick();
  assert.match(el.html, LOSTRE); assert.match(el.html, COPYRE); assert.ok(dis(el, 'save-add')); assert.equal(el.val('G_r_pref'), 'Typed note'); assert.equal(M._state().add.images.length, 2); assert.ok(M._state().d.stale);
  assert.equal(tagsOf(el, 'data-act', 'add-back').length, 0, 'Back is replaced by Cancel'); await clickA(el, 'save-add'); await tick(); assert.equal(cl.fcalls.filter((c) => c[1].action === 'save').length, 1);
  await clickA(el, 'add-cancel'); await tick(); assert.equal(M._state().add, null); assert.equal(nFn(cl, 'context'), 2, 'reloaded'); assert.doesNotMatch(el.html, /G_text|G_r_pref/); assert.ok(ena(el, 'add-open'));
});

// ---- 207 with failed details
test('G U7: a 207 where the details failed returns to review with the failed items listed, keeps the sheet and photos, and does not add what saved twice', async () => {
  const saves = []; let n = 0;
  const cl = reviewClient((b) => { saves.push(b); return n++ === 0 ? { status: 207, j: { ok: false, saved: [{ what: 'profile', ok: false, reason: 'save_failed' }, { what: 'companion', ok: true }, { what: 'id_photo', ok: true }] } } : { status: 200, j: { ok: true, saved: [{ what: 'profile', ok: true }] } }; });
  const { M, el } = await toReviewWith(cl);
  await clickA(el, 'save-add'); await tick();
  const A = M._state().add; assert.equal(A.step, 'review'); assert.ok(A.sheet); assert.equal(A.images.length, 2); assert.match(el.html, /Check before saving/); assert.match(el.html, /The details did not save\./); assert.match(el.html, /Companion added\./);
  assert.equal(A.sheet.companions[0].on, true, 'the server matches names it has, so a resend adds nobody twice'); assert.equal(A.sheet.ids[0].on, false); assert.ok(!M._state().d.stale);
  await clickA(el, 'save-add'); await tick();
  assert.equal(saves.length, 2); assert.deepEqual(saves[1].companions, ['Carla Dizon'], 'the companion is sent again; the server matches it by name'); assert.equal(saves[1].ids, undefined, 'the ID that saved is not');
  assert.equal(M._state().add.step, 'done'); assert.deepEqual(plain(M._state().add.images), []); assert.equal(M._state().add.sheet, null, 'a full success clears them');
});

test('G U7: a 207 where the details failed because someone else changed them locks Save with the Cancel hint', async () => {
  const cl = reviewClient(() => ({ status: 207, j: { ok: false, saved: [{ what: 'profile', ok: false, reason: 'changed' }] } })), { M, el } = await toReviewWith(cl);
  await clickA(el, 'save-add'); await tick();
  assert.match(el.html, /were changed by someone else/); assert.match(el.html, COPYRE); assert.ok(dis(el, 'save-add')); assert.equal(M._state().add.images.length, 2);
});

test('G U7: Read that fails, or loses its answer, unlocks the page with the text kept, and can be tried again', async () => {
  for (const first of [{ status: 500, j: { error: 'read_failed' } }, 'lost']) {
    let n = 0; const cl = detailClient({ fn: (b) => (b.action === 'context' ? CTX : n++ === 0 ? (first === 'lost' ? LOSTFN() : first) : { status: 200, j: { ok: true, proposal: PROPOSAL } }) });
    const { M, el } = await mount(cl, GID); await clickA(el, 'add-open'); el.type('G_text', 'Hi there'); await clickA(el, 'read'); await tick();
    assert.equal(M._state().add.step, 'input'); assert.equal(el.val('G_text'), 'Hi there'); assert.ok(ena(el, 'read') && ena(el, 'add-cancel')); assert.match(el.html, /id="G_aerr"/);
    await clickA(el, 'read'); await tick(); assert.match(el.html, /Check before saving/);
  }
});

// ---- the profile could not be read
test('G U7: when the profile could not be read, Edit is hidden, Try again is offered, and no save is ever sent with a null version', async () => {
  let ok = false;
  const cl = detailClient({ tables: { guests: { data: GUEST, error: null }, guest_profile_details: () => (ok ? { data: PROFILE, error: null } : { data: null, error: { message: 'TypeError: Failed to fetch' } }) } });
  const { M, el } = await mount(cl, GID);
  assert.equal(tagsOf(el, 'data-act', 'edit').length, 0, 'no Edit button and no editable row'); assert.match(el.html, /could not load, so they cannot be changed yet/); assert.ok(ena(el, 'detail-retry'));
  await clickA(el, 'edit'); assert.equal(M._state().edit, null); assert.equal(nCalls(cl, 'save_guest_profile_v1'), 0);
  ok = true; await clickA(el, 'detail-retry'); await tick(); assert.ok(ena(el, 'edit')); await clickA(el, 'edit'); el.type('G_f_phone', '0999 1'); await clickA(el, 'save-edit'); await tick();
  assert.equal(cl.calls.find((c) => c[0] === 'save_guest_profile_v1')[1].p_expected_version, 4);
});

// ---- regressions from this branch
test('G U7: a photo removal that reloads keeps an unsaved guest-count draft for the same stay', async () => {
  const cl = detailClient({ rpcs: { list_guest_companions_v1: () => ({ data: COMPS, error: null }), staff_guest_stay_v1: () => ({ data: STAY, error: null }) },
    fn: (b) => (b.action === 'context' ? CTX : { status: 200, j: { ok: true, saved: [{ what: 'id_photo_removed', ok: true }, { what: 'profile', ok: true }] } }) });
  const { el } = await mount(cl, GID); await clickA(el, 'stay-inc'); assert.equal(outN(el), 3);
  await clickA(el, 'remove-photo', { id: CID }); await clickA(el, 'remove-photo-yes', { id: CID }); await tick();
  assert.equal(nCalls(cl, 'staff_guest_stay_v1'), 2, 'the page reloaded'); assert.equal(outN(el), 3, 'the draft survived'); assert.match(el.html, /data-act="stay-save"/);
});

test('G U7: a photo removal that succeeds but whose reload fails still says the photo was removed', async () => {
  let g = 0;
  const cl = detailClient({ tables: { guests: () => (g++ === 0 ? { data: GUEST, error: null } : { data: null, error: { message: 'TypeError: Failed to fetch' } }), guest_profile_details: { data: PROFILE, error: null } },
    fn: (b) => (b.action === 'context' ? CTX : { status: 200, j: { ok: true, saved: [{ what: 'id_photo_removed', ok: true }, { what: 'profile', ok: true }] } }) });
  const { el } = await mount(cl, GID); await clickA(el, 'remove-photo', { id: CID }); await clickA(el, 'remove-photo-yes', { id: CID }); await tick();
  assert.match(el.html, /ID photo removed\./); assert.match(el.html, /could not load/); assert.ok(ena(el, 'detail-retry'));
});

test('G U7: collapsing Add a companion keeps the typed name for when it opens again', async () => {
  const { M, el } = await mount(detailClient(), GID);
  await clickA(el, 'comp-add-open'); el.type('G_newc', 'Dino Lim'); await clickA(el, 'comp-add-open'); assert.doesNotMatch(el.html, /id="G_newc"/);
  await clickA(el, 'comp-add-open'); assert.equal(el.val('G_newc'), 'Dino Lim'); assert.equal(M._state().newc, 'Dino Lim');
});

// ---- disabled looks disabled
test('G U7: disabled rows, photo pickers and ticks are dimmed and inert exactly like a disabled button, and the CSS parses', () => {
  const norm = (s) => s.split(';').map((x) => x.trim().replace(/\s+/g, ' ')).filter(Boolean);
  const m = /\.btn\[disabled\]\s*\{([^}]*)\}/.exec(fs.readFileSync(path.join(root, 'styles.css'), 'utf8')); assert.ok(m, '.btn[disabled] exists');
  const mine = CSS.match(/[^{}]*\{[^}]*\}/g).find((r) => /\.G_frm\[disabled\]/.test(r)); assert.ok(mine, 'a rule covers the disabled rows');
  const sel = mine.slice(0, mine.indexOf('{')), decl = norm(mine.slice(mine.indexOf('{') + 1, mine.lastIndexOf('}')));
  for (const s of ['.G_frm[disabled]', '.G_pick:has(input:disabled)', '.chk[disabled]']) assert.ok(sel.includes(s), s);
  for (const d of norm(m[1])) assert.ok(decl.includes(d), 'same as .btn[disabled]: ' + d);
  assert.ok(decl.some((d) => /^cursor:/.test(d)), 'and the same cursor'); assert.equal((CSS.match(/\{/g) || []).length, (CSS.match(/\}/g) || []).length, 'braces balance'); assert.doesNotMatch(CSS, /\r/);
});

// ---- mutation survivors: every control the running states disable, and every click the guard refuses
test('G U7: during a count save every control that would start another write is disabled, including the confirm button and the photo pickers', async () => {
  const mk = () => { const [gate, release] = gateOf(); return { release, cl: detailClient({ rpcs: { list_guest_companions_v1: () => ({ data: COMPS, error: null }), staff_guest_stay_v1: () => ({ data: STAY, error: null }), set_stay_guest_count_v1: () => gate.then(SAVED_OK) } }) }; };
  const a = mk(), { el } = await mount(a.cl, GID);
  await clickA(el, 'comp-open', { id: CID }); await clickA(el, 'comp-add-open'); el.type('G_newc', 'Dino Lim'); await clickA(el, 'stay-inc'); await clickA(el, 'stay-save'); await clickA(el, 'confirm-no'); await tick(); // the redraw while the save runs is what draws the controls disabled
  for (const act of ['edit', 'add-open', 'stay-save', 'stay-undo']) assert.ok(dis(el, act), act);
  assert.ok(disPick(el, 'replace'), 'the Replace photo pickers'); await clickA(el, 'comp-open', { id: CID2 }); assert.ok(dis(el, 'remove-comp'), 'Remove person'); assert.ok(disPick(el, 'replace'));
  await clickA(el, 'add-comp'); assert.equal(nCalls(a.cl, 'save_guest_companion_v1'), 0, 'Add companion is refused too');
  await clickA(el, 'remove-comp-yes', { id: CID2 }); assert.equal(nCalls(a.cl, 'delete_guest_companion_v1'), 0);
  a.release(); await tick(); await clickA(el, 'remove-comp', { id: CID2 }); assert.ok(ena(el, 'remove-comp-yes'), 'free again');
  const b = mk(), m2 = await mount(b.cl, GID); await clickA(m2.el, 'comp-open', { id: CID }); await clickA(m2.el, 'remove-photo', { id: CID }); assert.ok(ena(m2.el, 'remove-photo-yes'));
  await clickA(m2.el, 'stay-inc'); await clickA(m2.el, 'stay-save'); await clickA(m2.el, 'comp-add-open'); await tick(); assert.ok(dis(m2.el, 'remove-photo-yes'), 'the confirm button'); b.release(); await tick();
  // while a photo removal runs, the count Save is refused, not queued
  const [g2, r2] = gateOf(); const c2 = detailClient({ rpcs: { list_guest_companions_v1: () => ({ data: COMPS, error: null }), staff_guest_stay_v1: () => ({ data: STAY, error: null }), set_stay_guest_count_v1: SAVED_OK }, fn: (x) => (x.action === 'context' ? CTX : g2.then(() => ({ data: { ok: true, saved: [{ what: 'id_photo_removed', ok: true }] }, error: null }))) });
  const m3 = await mount(c2, GID); await clickA(m3.el, 'stay-inc'); await clickA(m3.el, 'remove-photo', { id: CID }); await clickA(m3.el, 'remove-photo-yes', { id: CID }); await clickA(m3.el, 'stay-save'); await tick();
  assert.equal(nCalls(c2, 'set_stay_guest_count_v1'), 0); r2(); await tick();
});

test('G U7: Retry buttons and Add ID photo are drawn disabled when the page is redrawn while a write runs', async () => {
  for (const kind of ['people', 'profile', 'noid']) {
    const [gate, release] = gateOf();
    const cl = detailClient({ tables: { guests: { data: GUEST, error: null }, guest_profile_details: kind === 'profile' ? { data: null, error: { message: 'TypeError: Failed to fetch' } } : { data: PROFILE, error: null } },
      rpcs: { list_guest_companions_v1: () => (kind === 'people' ? FETCH_ERR : { data: kind === 'noid' ? [COMPS[1]] : COMPS, error: null }), staff_guest_stay_v1: () => ({ data: STAY, error: null }), set_stay_guest_count_v1: () => gate.then(SAVED_OK) } });
    const { el } = await mount(cl, GID); const act = kind === 'noid' ? 'add-open' : 'detail-retry'; assert.ok(ena(el, act), kind);
    await clickA(el, 'stay-inc'); await clickA(el, 'stay-save'); await clickA(el, 'confirm-no'); await tick(); assert.ok(dis(el, act), kind); release(); await tick();
  }
});

test('G U7: while reading, Read and Cancel are disabled; while saving, the ticks and the sheet controls do nothing; a country email on file stays locked', async () => {
  const [gate, release] = gateOf(); let ex = 0;
  const cl = detailClient({ fn: (b) => (b.action === 'context' ? CTX : b.action === 'extract' ? (ex++, gate.then(() => ({ data: { ok: true, proposal: PROPOSAL }, error: null }))) : { status: 200, j: { ok: true, saved: [] } }) });
  const { M, el } = await mount(cl, GID); await clickA(el, 'add-open'); el.type('G_text', 'Hi'); await clickA(el, 'read'); await tick();
  assert.ok(dis(el, 'read') && dis(el, 'add-cancel')); await clickA(el, 'read'); await clickA(el, 'add-cancel'); await tick(); assert.equal(ex, 1, 'a second Read is refused'); assert.ok(M._state().add);
  release(); await tick(); assert.match(el.html, /id="G_r_email"[^>]*\sdisabled/, 'the email already on file is locked');
  const [g2, r2] = gateOf(); const own = { ...PROPOSAL, ids: [{ image: 0, name: 'Zed Quill', id_type: 'passport', own: true }] };
  const c2 = reviewClient(() => g2.then(() => ({ data: { ok: true, saved: [{ what: 'profile', ok: true }] }, error: null })), own), m2 = await toReviewWith(c2, [IMG('QUFB')]);
  const sh = () => m2.M._state().add.sheet; assert.equal(sh().ids[0].yes, true);
  await clickA(m2.el, 'save-add'); await tick(); assert.equal(m2.M._state().add.step, 'saving');
  for (const a of ['id-on', 'id-yes', 'comp-on']) await clickA(m2.el, a, { i: 0 });
  assert.equal(sh().ids[0].on, true); assert.equal(sh().ids[0].yes, true); assert.equal(sh().companions[0].on, true, 'comp-on'); assert.ok(dis(m2.el, 'comp-on') && dis(m2.el, 'save-add') && dis(m2.el, 'add-back'));
  r2(); await tick();
});

test('G U7: with a form open the photo viewer cannot turn a photo, and a photo cannot be turned for a guest whose page is another photo', async () => {
  const cl = rotCl(() => ({ data: { ok: true }, error: null })), { M, el } = await rotOpen(cl);
  await clickA(el, 'edit'); assert.ok(M._state().edit); await clickA(el, 'full-rot'); await sleep(700); assert.equal(nCalls(cl, 'set_guest_photo_rotation_v1'), 0); assert.ok(!M._state().rot);
  const two = [{ ...COMPS[0] }, { ...COMPS[1], id_photo_path: CID2 + '/b.jpg' }];
  const c2 = rotDetail({ list_guest_companions_v1: () => ({ data: two, error: null }), staff_guest_stay_v1: () => ({ data: STAY, error: null }), set_guest_photo_rotation_v1: (a) => ({ data: { ok: true, path: a.p_path, rotation: a.p_rotation }, error: null }) });
  const m2 = await mount(c2, GID); await tick(); await clickA(m2.el, 'show-id', { id: CID }); await tick(); await clickA(m2.el, 'show-id', { id: CID2 }); await tick(); await clickA(m2.el, 'full', { id: CID }); await clickA(m2.el, 'full-rot'); await clickA(m2.el, 'full-close'); await clickA(m2.el, 'full', { id: CID2 });
  assert.equal(m2.M._state().rot, 1); assert.ok(dis(m2.el, 'full-rot'), 'a turn waiting for photo A does not merge a tap on photo B'); await sleep(700); await tick();
  assert.equal(nCalls(c2, 'set_guest_photo_rotation_v1'), 1);
});

test('G U7: a database refusal that carries a status or a conflict code is a definite answer or a conflict, never a lost one', async () => {
  const cases = [[{ message: 'Internal Server Error', status: 500 }, false], [{ code: '40001', message: 'conflict' }, true], [{ code: 'P0001', message: 'stale version' }, true]];
  for (const [error, conflict] of cases) {
    const cl = detailClient({ rpcs: { list_guest_companions_v1: () => ({ data: COMPS, error: null }), save_guest_profile_v1: () => ({ data: null, error }) } });
    const { M, el } = await mount(cl, GID); await clickA(el, 'edit'); el.type('G_f_phone', '0999 1'); await clickA(el, 'save-edit'); await tick();
    assert.equal(!!M._state().d.stale, conflict, error.message + error.code); assert.doesNotMatch(el.html, LOSTRE);
    if (conflict) assert.match(el.html, /Someone else changed this guest/); else assert.ok(ena(el, 'save-edit'));
  }
});

test('G U7: a conflict answer from the function reloads at once with the changed sentence, for removal and for replace, 207 or not', async () => {
  const run = async (resp, act) => {
    const cl = detailClient({ fn: (b) => (b.action === 'context' ? CTX : resp) }), m = await mount(cl, GID), im = withImage(m.win);
    if (act === 'replace') { await m.el.l.change[0](pickEv('replace', CID)); im.fire(); } else { await clickA(m.el, 'remove-photo', { id: CID }); await clickA(m.el, 'remove-photo-yes', { id: CID }); }
    await tick(); return { cl, el: m.el };
  };
  for (const act of ['remove', 'replace']) for (const resp of [{ status: 409, j: { error: 'changed' } }, { status: 207, j: { ok: false, saved: [{ what: act === 'remove' ? 'id_photo_removed' : 'id_photo', ok: false, reason: 'changed' }] } }]) {
    const { cl, el } = await run(resp, act); assert.equal(nFn(cl, 'context'), 2, act + ' ' + resp.status + ': reloaded'); assert.match(el.html, /changed (this guest|by someone else)/, act + ' ' + resp.status);
  }
});

test('G U7: Add a companion: a conflict reloads; a lost answer where the name was already there, or the re-read fails, keeps the field', async () => {
  const cl = detailClient({ rpcs: { list_guest_companions_v1: () => ({ data: COMPS, error: null }), save_guest_companion_v1: () => ({ data: null, error: { code: '40001', message: 'stale version' } }) } });
  const a = await mount(cl, GID); await clickA(a.el, 'comp-add-open'); a.el.type('G_newc', 'Dino Lim'); await clickA(a.el, 'add-comp'); await tick();
  assert.equal(nCalls(cl, 'list_guest_companions_v1'), 2, 'reloaded'); assert.match(a.el.html, /Someone else changed this guest/); assert.equal(a.M._state().cbusy, '');
  const b = await mount(detailClient({ rpcs: { list_guest_companions_v1: () => ({ data: COMPS, error: null }), save_guest_companion_v1: () => FETCH_ERR } }), GID);
  await clickA(b.el, 'comp-add-open'); b.el.type('G_newc', 'Ben Cruz'); await clickA(b.el, 'add-comp'); await tick();
  assert.equal(b.el.val('G_newc'), 'Ben Cruz', 'the person was there before, so nothing was added'); assert.match(b.el.html, LOSTRE); assert.doesNotMatch(b.el.html, /Ben Cruz was added/);
  let n = 0; const c = await mount(detailClient({ rpcs: { list_guest_companions_v1: () => (n++ === 0 ? { data: COMPS, error: null } : FETCH_ERR), save_guest_companion_v1: () => FETCH_ERR } }), GID);
  await clickA(c.el, 'comp-add-open'); c.el.type('G_newc', 'Dino Lim'); await clickA(c.el, 'add-comp'); await tick();
  assert.match(c.el.html, LOSTRE); assert.doesNotMatch(c.el.html, /Dino Lim was added/, 'a failed re-read does not claim the add'); assert.equal(c.M._state().cbusy, '');
});

test('G U7: a 207 where every item failed leaves them ticked, so Save can try them again', async () => {
  const cl = reviewClient(() => ({ status: 207, j: { ok: false, saved: [{ what: 'profile', ok: false, reason: 'save_failed' }, { what: 'companion', ok: false, reason: 'save_failed' }, { what: 'id_photo', ok: false, reason: 'upload_failed' }] } })), { M, el } = await toReviewWith(cl);
  await clickA(el, 'save-add'); await tick(); const s = M._state().add.sheet; assert.equal(s.companions[0].on, true); assert.equal(s.ids[0].on, true); assert.match(el.html, /did not upload/);
});

test('G U7: Cancel on Add from text asks only when something would be lost', async () => {
  const cl = detailClient(), { M, el, win } = await mount(cl, GID); let asked = 0, yes = false; Object.defineProperty(win, 'confirm', { configurable: true, value: () => { asked++; return yes; } });
  await clickA(el, 'add-open'); await clickA(el, 'add-cancel'); assert.equal(asked, 0, 'nothing typed: no question'); assert.equal(M._state().add, null);
  await clickA(el, 'add-open'); el.type('G_text', 'Hi'); await clickA(el, 'add-cancel'); assert.equal(asked, 1); assert.ok(M._state().add, 'a No keeps it');
  yes = true; await clickA(el, 'add-cancel'); assert.equal(M._state().add, null);
});

test('G U7: a reload after a photo removal drops the count draft when the stay changed underneath', async () => {
  let n = 0;
  const cl = detailClient({ rpcs: { list_guest_companions_v1: () => ({ data: COMPS, error: null }), staff_guest_stay_v1: () => ({ data: n++ === 0 ? STAY : { ...STAY, uid: 'stay-uid-2', guest_count: 1, version: 8 }, error: null }) },
    fn: (b) => (b.action === 'context' ? CTX : { status: 200, j: { ok: true, saved: [{ what: 'id_photo_removed', ok: true }, { what: 'profile', ok: true }] } }) });
  const { el } = await mount(cl, GID); await clickA(el, 'stay-inc'); assert.equal(outN(el), 3);
  await clickA(el, 'remove-photo', { id: CID }); await clickA(el, 'remove-photo-yes', { id: CID }); await tick(); assert.equal(outN(el), 1, 'the other stay shows its own number'); assert.doesNotMatch(el.html, /data-act="stay-save"/);
});

test('G U7: Show more guests is disabled while the next page loads', async () => {
  const [gate, release] = gateOf(); let n = 0; const row = { ...GUEST, guest_profile_details: { id_on_file: false, birthday: null, vip: false }, guest_companions: [] };
  const cl = client({ tables: { guests: () => (n++ === 0 ? { data: [row], count: 40, error: null } : gate.then(() => ({ data: [{ ...row, id: 'g2' }], count: 40, error: null }))) }, rpcs: { staff_guest_stays_v1: () => ({ data: [], error: null }) } });
  const { el } = await mount(cl, ''); assert.ok(ena(el, 'more')); await clickA(el, 'more'); await tick(); assert.ok(dis(el, 'more')); release(); await tick();
});

// ======================================================================== U8: closing fixes from the U7 review
const REAL_LOST_RPC = { data: null, error: { message: 'TypeError: Failed to fetch' } }; // the real shape of a dropped answer
const NEWC = (name) => ({ id: 'n-' + name, guest_id: GID, name, id_type: null, id_number: null, id_photo_path: null });

test('G U8: a lost add whose re-read also fails locks Add until a reload works; a forced tap sends nothing', async () => {
  let ok = false, reads = 0;
  const cl = detailClient({ rpcs: { list_guest_companions_v1: () => (reads++ === 0 || ok ? { data: COMPS, error: null } : FETCH_ERR), save_guest_companion_v1: () => FETCH_ERR } });
  const { M, el } = await mount(cl, GID); await clickA(el, 'comp-add-open'); el.type('G_newc', 'Dino Lim'); await clickA(el, 'add-comp'); await tick();
  assert.equal(nCalls(cl, 'save_guest_companion_v1'), 1); assert.match(el.html, LOSTRE); assert.equal(M._state().cbusy, '');
  assert.equal(tagsOf(el, 'data-act', 'add-comp').length, 0, 'no Add button until the page reads again');
  await clickA(el, 'add-comp'); await clickA(el, 'add-comp'); await tick(); assert.equal(nCalls(cl, 'save_guest_companion_v1'), 1, 'a forced tap sends nothing');
  ok = true; await clickA(el, 'detail-retry'); await tick(); assert.ok(tagsOf(el, 'data-act', 'comp-add-open').length > 0, 'the page works again after a good reload');
});

test('G U8: a lost add of a name already on file clears the field when the count went up, and keeps it when it did not', async () => {
  for (const landed of [true, false]) {
    let reads = 0;
    const cl = detailClient({ rpcs: { list_guest_companions_v1: () => ({ data: reads++ === 0 || !landed ? COMPS : [...COMPS, NEWC('Ben Cruz')], error: null }), save_guest_companion_v1: () => REAL_LOST_RPC } });
    const { M, el } = await mount(cl, GID); await clickA(el, 'comp-add-open'); el.type('G_newc', 'Ben Cruz'); await clickA(el, 'add-comp'); await tick();
    if (landed) { assert.match(el.html, /Ben Cruz was added\./); assert.equal(M._state().newc, ''); assert.doesNotMatch(el.html, LOSTRE); }
    else { assert.equal(el.val('G_newc'), 'Ben Cruz'); assert.match(el.html, LOSTRE); assert.doesNotMatch(el.html, /Ben Cruz was added/); }
  }
});

const rotGate = () => {
  const [gate, release] = gateOf(); const st = { sent: [], inflight: 0, max: 0, release };
  st.cl = rotCl((a) => { st.sent.push(a.p_rotation); st.inflight++; st.max = Math.max(st.max, st.inflight); return gate.then(() => { st.inflight--; return { data: { ok: true, path: a.p_path, rotation: a.p_rotation }, error: null }; }); });
  return st;
};
test('G U8: leaving and coming back while a rotation call is out never starts a second call; the latest value goes out once afterwards', async () => {
  const st = rotGate(), m = await rotOpen(st.cl);
  await clickA(m.el, 'full-rot'); await sleep(700); assert.deepEqual(st.sent, [90], 'the first call is out');
  m.M.unmount(); const el2 = new FakeEl();
  m.M.mount(el2, { client: st.cl, demo: false, role: 'owner', sub: GID, propertyId: PROP, navigate: () => {}, toast: () => {}, haptic: () => {} }); await tick();
  await clickA(el2, 'full', { id: CID }); await tick(); await clickA(el2, 'full-rot'); await clickA(el2, 'full-rot'); await sleep(700);
  assert.deepEqual(st.sent, [90], 'a tap on the new page while the call is out sends nothing yet'); assert.equal(st.max, 1);
  assert.ok(m.M._state().rot, 'the new page still counts the turn as a write');
  m.M.unmount(); const el3 = new FakeEl();
  m.M.mount(el3, { client: st.cl, demo: false, role: 'owner', sub: GID, propertyId: PROP, navigate: () => {}, toast: () => {}, haptic: () => {} }); await tick();
  await clickA(el3, 'full', { id: CID }); await tick(); await clickA(el3, 'full-rot'); await sleep(700); assert.deepEqual(st.sent, [90], 'still one call out');
  st.release(); await tick(30); await sleep(20);
  assert.deepEqual(st.sent, [90, 0], 'only the latest value (a third page turned it to 0) is sent, once, after the answer'); assert.equal(st.max, 1, 'never two in flight'); assert.ok(!m.M._state().rot, 'the lock clears at the end'); assert.match(el3.html, /Saved for everyone/);
});

test('G U8: Remove person for a companion that is already gone says so and reloads once; a missing guest keeps its own sentence and does not reload', async () => {
  const run = async (message) => {
    const cl = detailClient({ rpcs: { list_guest_companions_v1: () => ({ data: COMPS, error: null }), delete_guest_companion_v1: () => ({ data: null, error: { code: 'P0002', message } }) } });
    const { el } = await mount(cl, GID); await clickA(el, 'remove-comp', { id: CID2 }); await clickA(el, 'remove-comp-yes', { id: CID2 }); await tick(); return { cl, el };
  };
  const a = await run('companion not found'); assert.match(a.el.html, /That person is no longer on this guest/); assert.equal(nCalls(a.cl, 'list_guest_companions_v1'), 2, 'one reload'); assert.doesNotMatch(a.el.html, /This guest is no longer on file/);
  const b = await run('guest not found'); assert.match(b.el.html, /This guest is no longer on file/); assert.equal(nCalls(b.cl, 'list_guest_companions_v1'), 1, 'no reload'); assert.doesNotMatch(b.el.html, /That person is no longer/);
});

const TWO = { ...PROPOSAL, companions: ['Carla Dizon', 'Dino Lim'], ids: [{ image: 0, name: 'Carla Dizon', id_type: 'passport', own: false }, { image: 1, name: 'Dino Lim', id_type: 'passport', own: false }] };
test('G U8: a 207 with two companions and two photos, one of each failing: the retry resends both companions and only the photo that failed', async () => {
  const saves = []; let n = 0;
  const cl = reviewClient((b) => { saves.push(b); return n++ === 0 ? { status: 207, j: { ok: false, saved: [{ what: 'companion', ok: true }, { what: 'companion', ok: false, reason: 'save_failed' }, { what: 'id_photo', ok: true }, { what: 'id_photo', ok: false, reason: 'upload_failed' }, { what: 'profile', ok: false, reason: 'save_failed' }] } } : { status: 200, j: { ok: true, saved: [{ what: 'profile', ok: true }] } }; }, TWO);
  const { M, el } = await toReviewWith(cl, [IMG('QUFB'), IMG('REVG')]);
  await clickA(el, 'save-add'); await tick(); const s = M._state().add.sheet;
  assert.deepEqual(plain(s.companions.map((c) => c.on)), [true, true], 'companions stay ticked: the server matches names it already has'); assert.deepEqual(plain(s.ids.map((d) => d.on)), [false, true], 'only the photo that saved is unticked');
  await clickA(el, 'save-add'); await tick();
  assert.deepEqual(saves[0].ids.map((d) => d.name), ['Carla Dizon', 'Dino Lim']); assert.deepEqual(saves[1].companions, ['Carla Dizon', 'Dino Lim']);
  assert.equal(saves[1].ids.length, 1); assert.equal(saves[1].ids[0].name, 'Dino Lim'); assert.equal(saves[1].ids[0].image.base64, 'REVG', 'the photo that failed, and no other');
  assert.equal(M._state().add.step, 'done');
});

test('G U8: a 207 whose id_photo items do not match the photos sent unticks none, so nothing is lost', async () => {
  const cl = reviewClient(() => ({ status: 207, j: { ok: false, saved: [{ what: 'id_photo', ok: true }, { what: 'profile', ok: false, reason: 'save_failed' }] } }), TWO), { M, el } = await toReviewWith(cl, [IMG('QUFB'), IMG('REVG')]);
  await clickA(el, 'save-add'); await tick(); assert.deepEqual(plain(M._state().add.sheet.ids.map((d) => d.on)), [true, true]);
});

test('G U8: when the profile could not be read there is no Add from text and no Add ID photo, and a forced tap opens nothing', async () => {
  const bad = () => ({ data: null, error: { message: 'TypeError: Failed to fetch' } });
  const cl = detailClient({ tables: { guests: { data: GUEST, error: null }, guest_profile_details: bad } }), { M, el } = await mount(cl, GID);
  assert.equal(tagsOf(el, 'data-act', 'add-open').length, 0); assert.ok(ena(el, 'detail-retry'), 'Try again is offered'); await clickA(el, 'add-open'); assert.equal(M._state().add, null);
  const c2 = detailClient({ tables: { guests: { data: GUEST, error: null }, guest_profile_details: bad }, rpcs: { list_guest_companions_v1: () => ({ data: [COMPS[1]], error: null }) } }), n2 = await mount(c2, GID);
  assert.match(n2.el.html, /No ID photo yet/, 'the guest has no ID row, where Add ID photo would be drawn'); assert.equal(tagsOf(n2.el, 'data-act', 'add-open').length, 0, 'and it is not drawn');
});
test('G U8: G_saveAdd sends nothing while the profile was not read', async () => {
  const { M, el } = await toReviewWith(reviewClient(() => ({ status: 200, j: { ok: true, saved: [{ what: 'profile', ok: true }] } }))); const cl = M._state().client; M._state().d.detailsOk = false;
  await clickA(el, 'save-add'); await tick(); assert.equal(cl.fcalls.filter((c) => c[1].action === 'save').length, 0); assert.equal(M._state().add.step, 'review'); assert.ok(M._state().add.err.length > 0);
});

test('G U8: a photo replace that saved, with a details conflict, reloads through the stale path and the green box holds only the saved photo', async () => {
  const cl = detailClient({ fn: (b) => (b.action === 'context' ? CTX : { status: 207, j: { ok: false, saved: [{ what: 'id_photo', ok: true }, { what: 'profile', ok: false, reason: 'changed' }] } }) }), m = await mount(cl, GID), im = withImage(m.win);
  await m.el.l.change[0](pickEv('replace', CID)); im.fire(); await tick();
  assert.equal(nFn(cl, 'context'), 2, 'reloaded'); const ok = /<div class="okbox[^>]*>.*?<\/div>/s.exec(m.el.html), er = /<div class="errbox[^>]*>.*?<\/div>/s.exec(m.el.html);
  assert.ok(ok && /ID photo saved\./.test(ok[0]) && !/changed/.test(ok[0]), 'green box: the photo only'); assert.ok(er && /Someone else changed this guest\./.test(er[0]), 'the conflict is in the red box'); assert.doesNotMatch(m.el.html, COPYRE);
});

test('G U8: the unsaved count survives a removal whose reload fails, then Try again, while the stay is the same', async () => {
  for (const same of [true, false]) {
    let mode = 'ok';
    const cl = detailClient({ tables: { guests: () => (mode === 'fail' ? { data: null, error: { message: 'TypeError: Failed to fetch' } } : { data: GUEST, error: null }), guest_profile_details: { data: PROFILE, error: null } },
      rpcs: { list_guest_companions_v1: () => ({ data: COMPS, error: null }), staff_guest_stay_v1: () => ({ data: same || mode === 'ok' ? STAY : { ...STAY, uid: 'stay-uid-2' }, error: null }) },
      fn: (b) => (b.action === 'context' ? CTX : { status: 200, j: { ok: true, saved: [{ what: 'id_photo_removed', ok: true }, { what: 'profile', ok: true }] } }) });
    const { el } = await mount(cl, GID); await clickA(el, 'stay-inc'); assert.equal(outN(el), 3);
    mode = 'fail'; await clickA(el, 'remove-photo', { id: CID }); await clickA(el, 'remove-photo-yes', { id: CID }); await tick(); assert.match(el.html, /could not load/);
    mode = 'retry'; await clickA(el, 'detail-retry'); await tick();
    if (same) { assert.equal(outN(el), 3, 'the draft survived the failed reload'); assert.match(el.html, /data-act="stay-save"/); } else assert.equal(outN(el), 2, 'a different stay drops the draft');
  }
});

test('G U8: both Add from text pickers carry G_pick, so they dim like the other pickers; the rule changes no layout', async () => {
  const [gate, release] = gateOf();
  const cl = detailClient({ fn: (b) => (b.action === 'context' ? CTX : gate.then(() => ({ status: 200, j: { ok: true, proposal: PROPOSAL } }))) }), { el } = await mount(cl, GID);
  await clickA(el, 'add-open'); const labels = [...el.html.matchAll(/<label class="([^"]*)">[^]*?data-pick="shot"[^>]*>/g)]; assert.equal(labels.length, 2); for (const l of labels) assert.match(l[1], /\bG_pick\b/);
  el.type('G_text', 'hi'); await clickA(el, 'read'); assert.equal(tagsOf(el, 'data-pick', 'shot').filter((t) => / disabled[ >]/.test(t)).length, 2, 'both are disabled while reading'); release(); await tick();
  const rule = [...CSS.matchAll(/(^|\n)\.G_pick\s*\{([^}]*)\}/g)].map((m) => m[2]).join(''); assert.doesNotMatch(rule, /width|height|margin|padding|display|flex|grid/);
});

test('G U8: wording: Someone else changed this guest, The details were changed by someone else, and the Copy hint only with a form open', async () => {
  const t = load().M._t; assert.equal(t.errText(0, 'changed'), 'Someone else changed this guest.'); assert.equal(t.rpcText({ code: '40001' }), 'Someone else changed this guest.');
  assert.deepEqual(t.saveLines([{ what: 'profile', ok: false, reason: 'changed' }, { what: 'companion', ok: false, reason: 'denied' }]), ['The details were changed by someone else.', 'The companion was not allowed.']);
  const a = await mount(detailClient({ rpcs: { list_guest_companions_v1: () => ({ data: COMPS, error: null }), delete_guest_companion_v1: () => ({ data: null, error: { code: '40001', message: 'stale version' } }) } }), GID);
  await clickA(a.el, 'remove-comp', { id: CID2 }); await clickA(a.el, 'remove-comp-yes', { id: CID2 }); await tick(); assert.match(a.el.html, /Someone else changed this guest\./); assert.doesNotMatch(a.el.html, COPYRE); assert.doesNotMatch(a.el.html, /while you were editing/);
  const b = await mount(detailClient({ rpcs: { list_guest_companions_v1: () => ({ data: COMPS, error: null }), save_guest_profile_v1: () => ({ data: null, error: { code: '40001', message: 'stale version' } }) } }), GID);
  await clickA(b.el, 'edit'); b.el.type('G_f_phone', '0999 1'); await clickA(b.el, 'save-edit'); await tick(); assert.match(b.el.html, /Someone else changed this guest\./); assert.match(b.el.html, COPYRE);
});

// ======================================================================== U9: last closed list
const mountOpts = (cl, sub = GID) => ({ client: cl, demo: false, role: 'owner', sub, propertyId: PROP, navigate: () => {}, toast: () => {}, haptic: () => {} });
const NODET = { ...TWO, phone: null, stay_preferences: null, birthday: null, tags: [] }; // a sheet with no details to save: companions and photos only
const DETAIL_KEYS = ['phone', 'email', 'stay_preferences', 'birthday', 'tags'];
const photoFail207 = (profile) => ({ status: 207, j: { ok: false, saved: [{ what: 'companion', ok: true }, { what: 'companion', ok: true }, { what: 'id_photo', ok: true }, { what: 'id_photo', ok: false, reason: 'upload_failed' }, ...(profile ? [profile] : [])] } });
const retryOk = { status: 200, j: { ok: true, saved: [{ what: 'companion', ok: true }, { what: 'companion', ok: true }, { what: 'id_photo', ok: true }] } };

test('G U9 item 1: a turn queued behind a call that is out is sent after every page is unmounted, with the client it was tapped on', async () => {
  const st = rotGate(), m = await rotOpen(st.cl);
  await clickA(m.el, 'full-rot'); await sleep(700); assert.deepEqual(st.sent, [90]);
  m.M.unmount(); const el2 = new FakeEl(); m.M.mount(el2, mountOpts(st.cl)); await tick();
  await clickA(el2, 'full', { id: CID }); await tick(); await clickA(el2, 'full-rot'); await sleep(700); assert.deepEqual(st.sent, [90], 'queued behind the call that is out');
  m.M.unmount(); assert.equal(m.M._state(), null, 'no page is mounted');
  st.release(); await tick(30); await sleep(20);
  assert.deepEqual(st.sent, [90, 180], 'the queued 180 went out'); assert.equal(st.max, 1, 'never two in flight');
});

test('G U9 item 1: a tap followed by leaving Guests inside 600 ms still sends its value once', async () => {
  const st = rotGate(), m = await rotOpen(st.cl);
  await clickA(m.el, 'full-rot'); m.M.unmount(); await sleep(700); await tick();
  assert.deepEqual(st.sent, [90]); st.release(); await tick(30);
});

test('G U9 item 2: a 207 with the details saved and one photo failed goes back to review; the retry sends the failed photo and the companions, no details, no version', async () => {
  const saves = []; let n = 0;
  const cl = reviewClient((b) => { saves.push(b); return n++ === 0 ? photoFail207({ what: 'profile', ok: true }) : retryOk; }, TWO);
  const { M, el } = await toReviewWith(cl, [IMG('QUFB'), IMG('REVG')]);
  await clickA(el, 'save-add'); await tick();
  assert.equal(M._state().add.step, 'review', 'back to review, not a finished screen'); assert.match(M._state().add.err, /ID photo did not upload/);
  assert.ok(saves[0].phone && saves[0].expected_version === 4, 'the first save carried the details and the version');
  const s = M._state().add.sheet; assert.deepEqual(plain(s.ids.map((d) => d.on)), [false, true]);
  assert.deepEqual([s.phone, s.email, s.stay_preferences, s.birthday, s.tags], ['', '', '', '', ''], 'the saved details are cleared from the sheet');
  await clickA(el, 'save-add'); await tick();
  for (const k of [...DETAIL_KEYS, 'expected_version']) assert.ok(!(k in saves[1]), 'retry sends no ' + k);
  assert.deepEqual(saves[1].companions, ['Carla Dizon', 'Dino Lim']); assert.deepEqual(saves[1].ids.map((d) => [d.name, d.image.base64]), [['Dino Lim', 'REVG']]);
  assert.equal(M._state().add.step, 'done');
});

test('G U9 item 2: with no details sent and no profile item, one photo failing returns to review and the retry sends only the photo and the companions', async () => {
  const saves = []; let n = 0;
  const cl = reviewClient((b) => { saves.push(b); return n++ === 0 ? photoFail207(null) : retryOk; }, NODET);
  const { M, el } = await toReviewWith(cl, [IMG('QUFB'), IMG('REVG')]);
  await clickA(el, 'save-add'); await tick();
  for (const k of DETAIL_KEYS) assert.ok(!(k in saves[0]), 'first save sends no ' + k);
  assert.equal(M._state().add.step, 'review'); await clickA(el, 'save-add'); await tick();
  for (const k of [...DETAIL_KEYS, 'expected_version']) assert.ok(!(k in saves[1]), 'retry sends no ' + k);
  assert.deepEqual(saves[1].companions, ['Carla Dizon', 'Dino Lim']); assert.deepEqual(saves[1].ids.map((d) => d.image.base64), ['REVG']); assert.equal(M._state().add.step, 'done');
});

test('G U9 item 2: when the profile item failed, the retry still carries the details and the version', async () => {
  const saves = []; let n = 0;
  const cl = reviewClient((b) => { saves.push(b); return n++ === 0 ? photoFail207({ what: 'profile', ok: false, reason: 'save_failed' }) : { status: 200, j: { ok: true, saved: [{ what: 'profile', ok: true }] } }; }, TWO);
  const { M, el } = await toReviewWith(cl, [IMG('QUFB'), IMG('REVG')]);
  await clickA(el, 'save-add'); await tick(); assert.equal(M._state().add.step, 'review'); assert.equal(M._state().add.sheet.phone, '09175550000', 'the details stay on the sheet');
  await clickA(el, 'save-add'); await tick();
  assert.equal(saves[1].phone, '09175550000'); assert.equal(saves[1].expected_version, 4); assert.equal(saves[1].birthday, '1992-03-04'); assert.deepEqual(plain(saves[1].tags), ['anniversary']);
});

test('G U9 item 3: a lost add whose re-read fails clears the typed name, so reopening Add does not offer it again', async () => {
  let reads = 0, saves = 0;
  const cl = detailClient({ rpcs: { list_guest_companions_v1: () => { reads++; return reads === 2 ? REAL_LOST_RPC : { data: reads === 1 ? COMPS : [...COMPS, NEWC('Dino Lim')], error: null }; }, save_guest_companion_v1: () => { saves++; return REAL_LOST_RPC; } } });
  const { M, el } = await mount(cl, GID); await clickA(el, 'comp-add-open'); el.type('G_newc', 'Dino Lim'); await clickA(el, 'add-comp'); await tick(30);
  assert.equal(M._state().newc, ''); assert.match(el.html, /Dino Lim/); await clickA(el, 'comp-add-open'); assert.equal(el.val('G_newc'), '', 'the field is empty'); assert.equal(saves, 1);
});

const stayBad = { data: null, error: { message: 'TypeError: Failed to fetch' } };
const stayRig = () => { const r = { stay: 'ok' }; r.cl = detailClient({ rpcs: { list_guest_companions_v1: () => ({ data: COMPS, error: null }), staff_guest_stay_v1: () => (r.stay === 'fail' ? stayBad : { data: r.stay === 'B' ? { ...STAY, uid: 'stay-uid-2' } : STAY, error: null }) },
  fn: (b) => (b.action === 'context' ? CTX : { status: 200, j: { ok: true, saved: [{ what: 'id_photo_removed', ok: true }, { what: 'profile', ok: true }] } }) }); return r; };
const removePhoto = async (el) => { await clickA(el, 'remove-photo', { id: CID }); await clickA(el, 'remove-photo-yes', { id: CID }); await tick(); };

test('G U9 item 4: the count draft is kept when only the stay read fails, then comes back on the next good read of the same stay', async () => {
  const r = stayRig(), { M, el } = await mount(r.cl, GID); assert.equal(M._state().stayKept, null, 'a loaded page keeps nothing'); await clickA(el, 'stay-inc'); assert.equal(outN(el), 3);
  r.stay = 'fail'; await removePhoto(el); assert.equal(M._state().d.stay, null); assert.equal(M._state().stayKept && M._state().stayKept.draft, 3, 'the draft is held for the next read');
  r.stay = 'ok'; await removePhoto(el); assert.equal(outN(el), 3, 'the same stay gets its draft back'); assert.equal(M._state().stayKept, null);
});

test('G U9 item 4: a different stay on the next good read drops the held draft and clears it', async () => {
  const r = stayRig(), { M, el } = await mount(r.cl, GID); await clickA(el, 'stay-inc');
  r.stay = 'fail'; await removePhoto(el); r.stay = 'B'; await removePhoto(el);
  assert.equal(outN(el), 2, 'a different stay starts from its own number'); assert.equal(M._state().stayKept, null, 'the held draft is cleared once a stay loads');
});

test('G U9 item 5: Remove photo with a details conflict reloads through the stale path; the green box holds only the removal', async () => {
  const cl = detailClient({ fn: (b) => (b.action === 'context' ? CTX : { status: 207, j: { ok: false, saved: [{ what: 'id_photo_removed', ok: true }, { what: 'profile', ok: false, reason: 'changed' }] } }) });
  const { el } = await mount(cl, GID); await removePhoto(el);
  assert.equal(nFn(cl, 'context'), 2, 'reloaded once');
  const ok = /<div class="okbox[^>]*>.*?<\/div>/s.exec(el.html), er = /<div class="errbox[^>]*>.*?<\/div>/s.exec(el.html);
  assert.ok(ok && /ID photo removed\./.test(ok[0]) && !/changed/.test(ok[0]), 'green box: the removal only'); assert.ok(er && /Someone else changed this guest\./.test(er[0]), 'the conflict is in the red box');
});

test('G U9 item 6: a save answered ok with nothing in saved says Nothing new to save', async () => {
  const P = { ...PROPOSAL, phone: null, stay_preferences: null, birthday: null, tags: [], companions: ['Carla Dizon'], ids: [] };
  const cl = reviewClient(() => ({ status: 200, j: { ok: true, saved: [] } }), P);
  const { M, el } = await toReviewWith(cl, [IMG('QUFB')]); await clickA(el, 'save-add'); await tick();
  assert.equal(M._state().add.step, 'done'); assert.deepEqual(plain(M._state().add.lines), ['Nothing new to save.']); assert.match(/<div class="okbox[^>]*>.*?<\/div>/s.exec(el.html)[0], /Nothing new to save\./);
});

// mutants that survived the first review
test('G U9 mutant: a photo unticked before Save is not counted among the photos sent, so the one that saved is unticked', async () => {
  const cl = reviewClient(() => ({ status: 207, j: { ok: false, saved: [{ what: 'id_photo', ok: true }, { what: 'profile', ok: false, reason: 'save_failed' }] } }), TWO);
  const { M, el } = await toReviewWith(cl, [IMG('QUFB'), IMG('REVG')]);
  await clickA(el, 'id-on', { i: 0 }); assert.deepEqual(plain(M._state().add.sheet.ids.map((d) => d.on)), [false, true]);
  await clickA(el, 'save-add'); await tick();
  assert.deepEqual(plain(M._state().add.sheet.ids.map((d) => d.on)), [false, false], 'the one photo sent saved, so it is unticked');
});

test('G U9 mutant: reset forgets a rotation call that is out, so the next page sends at once', async () => {
  const st = rotGate(), m = await rotOpen(st.cl);
  await clickA(m.el, 'full-rot'); await sleep(700); assert.deepEqual(st.sent, [90]);
  m.M.reset(); const el2 = new FakeEl(); m.M.mount(el2, mountOpts(st.cl)); await tick();
  await clickA(el2, 'full', { id: CID }); await tick(); await clickA(el2, 'full-rot'); await sleep(700);
  assert.equal(st.sent.length, 2, 'the new session did not wait behind the old call'); st.release(); await tick(30); await sleep(20);
});

// ======================================================================== U10: last fixes
const noEmailTables = { guests: { data: { ...GUEST, email: null }, error: null }, guest_profile_details: { data: PROFILE, error: null } };
const withEmail = { ...TWO, email: 'new@example.test' };

test('G U10 item 1: after a 207 with something saved there is no Back on review; Cancel asks nothing and reloads once', async () => {
  let n = 0; const cl = reviewClient(() => (n++ === 0 ? photoFail207({ what: 'profile', ok: true }) : retryOk), TWO);
  const m = await toReviewWith(cl); let asked = 0; m.win.confirm = () => { asked++; return false; };
  await clickA(m.el, 'save-add'); await tick();
  assert.equal(m.M._state().add.step, 'review'); assert.ok(!/data-act="add-back"/.test(m.el.html), 'no Back'); assert.match(m.el.html, /data-act="add-cancel"/);
  const before = nFn(cl, 'context'); await clickA(m.el, 'add-cancel'); await tick();
  assert.equal(asked, 0, 'no confirm'); assert.equal(nFn(cl, 'context'), before + 1, 'exactly one reload'); assert.equal(m.M._state().add, null);
});

test('G U10 item 1: a 207 where nothing saved keeps Back and the confirm on Cancel', async () => {
  const cl = reviewClient(() => ({ status: 207, j: { ok: false, saved: [{ what: 'profile', ok: false, reason: 'save_failed' }] } }), TWO);
  const m = await toReviewWith(cl); let asked = 0; m.win.confirm = () => { asked++; return false; };
  await clickA(m.el, 'save-add'); await tick(); assert.match(m.el.html, /data-act="add-back"/); assert.ok(!/data-act="add-cancel"/.test(m.el.html));
});

test('G U10 item 2: a failed email stays in the field and goes again, without the version', async () => {
  const saves = []; let n = 0;
  const cl = reviewClient((b) => { saves.push(b); return n++ === 0 ? { status: 207, j: { ok: false, saved: [{ what: 'profile', ok: true }, { what: 'email', ok: false, reason: 'save_failed' }, { what: 'companion', ok: true }, { what: 'companion', ok: true }, { what: 'id_photo', ok: true }, { what: 'id_photo', ok: true }] } } : { status: 200, j: { ok: true, saved: [{ what: 'email', ok: true }] } }; }, withEmail, { tables: noEmailTables });
  const { M, el } = await toReviewWith(cl); assert.equal(M._state().add.sheet.email, 'new@example.test');
  await clickA(el, 'save-add'); await tick();
  const s = M._state().add.sheet; assert.equal(s.email, 'new@example.test', 'the email stays'); assert.deepEqual([s.phone, s.stay_preferences, s.birthday, s.tags], ['', '', '', '']);
  await clickA(el, 'save-add'); await tick();
  assert.equal(saves.length, 2); assert.equal(saves[1].email, 'new@example.test'); assert.ok(!('expected_version' in saves[1])); assert.ok(!('phone' in saves[1])); assert.equal(M._state().add.step, 'done');
});

test('G U10 item 2: an email that saved is cleared with the rest', async () => {
  const cl = reviewClient(() => ({ status: 207, j: { ok: false, saved: [{ what: 'profile', ok: true }, { what: 'email', ok: true }, { what: 'id_photo', ok: false, reason: 'upload_failed' }] } }), withEmail, { tables: noEmailTables });
  const { M, el } = await toReviewWith(cl); await clickA(el, 'save-add'); await tick(); assert.equal(M._state().add.sheet.email, '');
});

test('G U10 item 3: no Nothing is noted yet once the details are done', async () => {
  const noPref = { tables: { guests: { data: GUEST, error: null }, guest_profile_details: { data: { ...PROFILE, stay_preferences: null }, error: null } } };
  let n = 0; const cl = reviewClient(() => (n++ === 0 ? photoFail207({ what: 'profile', ok: true }) : retryOk), TWO, noPref);
  const { M, el } = await toReviewWith(cl); assert.match(el.html, /Nothing is noted yet\./);
  await clickA(el, 'save-add'); await tick(); assert.ok(M._state().add.noDetails); assert.doesNotMatch(el.html, /Nothing is noted yet\./);
});

test('G U10 item 4: a photo turn queued behind a call that is out is dropped once the session ends', async () => {
  const st = rotGate(), m = await rotOpen(st.cl);
  await clickA(m.el, 'full-rot'); await sleep(700); assert.deepEqual(st.sent, [90]);
  m.M.unmount(); const el2 = new FakeEl(); m.M.mount(el2, mountOpts(st.cl)); await tick();
  await clickA(el2, 'full', { id: CID }); await tick(); await clickA(el2, 'full-rot'); await sleep(700);
  m.M.reset(); st.release(); await tick(30); await sleep(20);
  assert.deepEqual(st.sent, [90], 'the queued turn was not sent after sign-out');
});

test('G U10 item 4: details sent with no profile item in the answer keep the sheet and the version', async () => {
  const saves = []; let n = 0;
  const cl = reviewClient((b) => { saves.push(b); return n++ === 0 ? { status: 207, j: { ok: false, saved: [{ what: 'id_photo', ok: false, reason: 'upload_failed' }] } } : { status: 200, j: { ok: true, saved: [{ what: 'profile', ok: true }] } }; }, TWO);
  const { M, el } = await toReviewWith(cl); await clickA(el, 'save-add'); await tick();
  assert.equal(M._state().add.sheet.phone, '09175550000', 'the sheet keeps the details'); assert.ok(!M._state().add.noDetails);
  await clickA(el, 'save-add'); await tick(); assert.equal(saves[1].phone, '09175550000'); assert.equal(saves[1].expected_version, 4);
});

// ======================================================================== U11: last closed list
const NOTHING_MORE = /There is nothing more to save\. Fill a field or keep a photo, or tap Cancel\./;
const part1 = () => photoFail207({ what: 'profile', ok: true }); // companions and photo 1 saved, photo 2 failed, details saved

test('G U11 item 1: once something has saved, an empty retry says Cancel, not Back; before any save the text is unchanged', async () => {
  let n = 0; const cl = reviewClient(() => (n++ === 0 ? part1() : retryOk), TWO);
  const { M, el } = await toReviewWith(cl); await clickA(el, 'save-add'); await tick(); assert.ok(M._state().add.landed);
  await clickA(el, 'comp-on', { i: 0 }); await clickA(el, 'comp-on', { i: 1 }); await clickA(el, 'id-on', { i: 1 });
  await clickA(el, 'save-add'); await tick();
  assert.equal(n, 1, 'nothing was sent'); assert.match(M._state().add.err, NOTHING_MORE); assert.doesNotMatch(M._state().add.err, /Back/);
  const fresh = await toReviewWith(reviewClient(() => retryOk, NODET), []); const A = fresh.M._state().add;
  await clickA(fresh.el, 'comp-on', { i: 0 }); await clickA(fresh.el, 'comp-on', { i: 1 });
  await clickA(fresh.el, 'save-add'); await tick(); assert.ok(!A.landed);
  assert.equal(A.err, 'There is nothing to save. Fill a field or keep a photo, or tap Back.');
});

test('G U11 item 2: Cancel after a partial save is disabled while saving, and enabled again after; a stale page keeps it enabled', async () => {
  let n = 0, release; const gate = new Promise((r) => { release = r; });
  const cl = reviewClient(() => (n++ === 0 ? part1() : gate.then(() => ({ data: retryOk.j, error: null }))), TWO);
  const { M, el } = await toReviewWith(cl); await clickA(el, 'save-add'); await tick();
  assert.ok(M._state().add.landed); assert.equal(dis(el, 'add-cancel'), false, 'enabled while reviewing');
  await clickA(el, 'save-add'); assert.equal(M._state().add.step, 'saving'); assert.ok(dis(el, 'add-cancel'), 'disabled while saving');
  release(); await tick(); assert.equal(M._state().add.step, 'done');
  const st = reviewClient(() => ({ status: 207, j: { ok: false, saved: [{ what: 'id_photo', ok: true }, { what: 'profile', ok: false, reason: 'changed' }] } }), TWO);
  const s = await toReviewWith(st); await clickA(s.el, 'save-add'); await tick();
  assert.ok(s.M._state().d.stale, 'stale'); assert.ok(tagsOf(s.el, 'data-act', 'add-cancel').length === 1 && !dis(s.el, 'add-cancel'), 'Cancel works on a stale page');
});

const rowTag = (el, i) => tagsOf(el, 'data-act', 'id-on')[i];

test('G U11 item 3: a photo that saved shows Saved, disabled and unticked, cannot be ticked again, and keeps its place', async () => {
  const saves = []; let n = 0;
  const cl = reviewClient((b) => { saves.push(b); return n++ === 0 ? part1() : { status: 207, j: { ok: false, saved: [{ what: 'id_photo', ok: false, reason: 'upload_failed' }] } }; }, TWO);
  const { M, el } = await toReviewWith(cl); await clickA(el, 'save-add'); await tick();
  const ids = M._state().add.sheet.ids; assert.equal(ids.length, 2); assert.deepEqual(plain(ids.map((d) => !!d.saved)), [true, false]);
  const rows = tagsOf(el, 'data-act', 'id-on'); assert.equal(rows.length, 2);
  assert.ok(/disabled/.test(rows[0]) && /aria-checked="false"/.test(rows[0]), 'saved row disabled and unticked'); assert.ok(!/disabled/.test(rows[1]), 'the failed photo can be ticked');
  assert.equal((el.html.match(/>Saved</g) || []).length, 1, 'one Saved label');
  assert.match(el.html, /<select id="G_io0"[^>]*disabled/, 'whose ID is locked on the saved row'); assert.match(el.html, /<select id="G_it0"[^>]*disabled/, 'ID type is locked on the saved row');
  assert.doesNotMatch(el.html, /<select id="G_io1"[^>]*disabled/, 'the failed photo stays editable'); assert.doesNotMatch(el.html, /<select id="G_it1"[^>]*disabled/);
  assert.match(el.html, /aria-label="ID photo saved"/); assert.match(el.html, /class="G_idform"><span class="help">Saved<\/span>/, 'the label sits in the form, not beside the photo');
  await clickA(el, 'id-on', { i: 0 }); assert.equal(M._state().add.sheet.ids[0].on, false, 'a tap on the saved row ticks nothing');
  await clickA(el, 'save-add'); await tick();
  assert.equal(saves[1].ids.length, 1, 'only the failed photo is sent again'); assert.equal(M._state().add.sheet.ids.length, 2);
});

test('G U13: on review the saved row name is disabled and keeps its value, the failed row stays editable with its own label', async () => {
  const cl = reviewClient(() => part1(), TWO);
  const { M, el } = await toReviewWith(cl); await clickA(el, 'save-add'); await tick();
  assert.match(el.html, /<input id="G_in0"[^>]*disabled/, 'saved name locked'); assert.doesNotMatch(el.html, /<input id="G_in0"[^>]*readonly/, 'not a focusable readonly field');
  assert.doesNotMatch(el.html, /<input id="G_in1"[^>]*(readonly|disabled)/, 'failed name editable');
  assert.match(rowTag(el, 1), /aria-label="Keep this ID photo"/); assert.equal(M._state().add.sheet.ids[0].name, 'Carla Dizon');
});

test('G U13: while a retry saves, the unsaved row is locked too', async () => {
  let n = 0, release; const gate = new Promise((r) => { release = r; });
  const cl = reviewClient(() => (n++ === 0 ? part1() : gate.then(() => ({ data: retryOk.j, error: null }))), TWO);
  const { M, el } = await toReviewWith(cl); await clickA(el, 'save-add'); await tick();
  await clickA(el, 'save-add'); assert.equal(M._state().add.step, 'saving');
  assert.match(el.html, /<select id="G_io1"[^>]*disabled/); assert.match(el.html, /<select id="G_it1"[^>]*disabled/); assert.match(el.html, /<input id="G_in1"[^>]*readonly/); assert.match(rowTag(el, 1), /disabled/);
  release(); await tick();
});

test('G U13: a saved photo of the guest that reads another name has its Yes tick locked', async () => {
  const OWN = { ...TWO, ids: [{ image: 0, name: 'Someone Else', id_type: 'passport', own: true }, TWO.ids[1]] };
  const { el } = await toReviewWith(reviewClient(() => part1(), OWN)); await clickA(el, 'save-add'); await tick();
  const yes = tagsOf(el, 'data-act', 'id-yes'); assert.equal(yes.length, 1); assert.match(yes[0], /disabled/);
});

// mutants that survived the review
test('G U11 mutant: a failed email the server kept (email_kept) is not put back in the field', async () => {
  const cl = reviewClient(() => ({ status: 207, j: { ok: false, saved: [{ what: 'profile', ok: true }, { what: 'email', ok: false, reason: 'email_kept' }, { what: 'id_photo', ok: false, reason: 'upload_failed' }] } }), withEmail, { tables: noEmailTables });
  const { M, el } = await toReviewWith(cl); await clickA(el, 'save-add'); await tick(); assert.equal(M._state().add.sheet.email, '');
});

test('G U11 mutant: landed stays true when a later retry saves nothing, so Cancel stays and Back does not return', async () => {
  let n = 0; const cl = reviewClient(() => (n++ === 0 ? part1() : { status: 207, j: { ok: false, saved: [{ what: 'id_photo', ok: false, reason: 'upload_failed' }] } }), TWO);
  const { M, el } = await toReviewWith(cl); await clickA(el, 'save-add'); await tick(); await clickA(el, 'save-add'); await tick();
  assert.equal(n, 2); assert.ok(M._state().add.landed); assert.ok(!/data-act="add-back"/.test(el.html)); assert.match(el.html, /data-act="add-cancel"/);
});

// ------------------------------------------------------------------------------------------------ s130: the Edit notes screen
const NOTED = '2026-10-10: !!! Allergic to nuts || 2026-10-12: Late arrival || 2026-09-01: Suggestion: a kettle';
const notesClient = (stored = NOTED, saveFn = null) => { const saves = []; const c = detailClient({ tables: { guests: { data: GUEST, error: null }, guest_profile_details: { data: { ...PROFILE, stay_preferences: stored }, error: null } },
  rpcs: { list_guest_companions_v1: () => ({ data: COMPS, error: null }), save_guest_profile_v1: (a) => { saves.push(plain(a)); return saveFn ? saveFn(a) : { data: { ok: true, version: 5 }, error: null }; } } }); c.saves = saves; return c; };

test('G s130: the notes screen lists most important first and the card is notepaper', async () => {
  const { el } = await mount(notesClient(), GID + '/notes');
  assert.match(el.html, /Add a note/); assert.match(el.html, /N_paper/);
  assert.ok(el.html.indexOf('Allergic to nuts') < el.html.indexOf('Late arrival'), 'level 3 first');
  assert.match(el.html, /aria-label="Importance 3 of 3"/);
  assert.match(el.html, /Guest suggestion/);
});

test('G s130: add saves only stay_preferences with the loaded version and the reason Note added', async () => {
  const cl = notesClient(); const { el } = await mount(cl, GID + '/notes');
  await clickA(el, 'n-add'); await tick();
  assert.match(el.html, /id="G_n_text"/); assert.match(el.html, /role="checkbox"[^>]*aria-checked="false"|aria-checked="false"[^>]*role="checkbox"/);
  el.type('G_n_text', 'Needs a crib'); await clickA(el, 'n-level', { v: '2' }); await clickA(el, 'n-save'); await tick();
  assert.equal(cl.saves.length, 1);
  assert.deepEqual(Object.keys(cl.saves[0].p_patch), ['stay_preferences']);
  assert.equal(cl.saves[0].p_expected_version, 4); assert.equal(cl.saves[0].p_reason, 'Note added');
  assert.equal(cl.saves[0].p_patch.stay_preferences, NOTED + ' || 2026-10-14: !! Needs a crib');
});

test('G s130: saving a note without a change writes nothing', async () => {
  const cl = notesClient(); const { el } = await mount(cl, GID + '/notes');
  await clickA(el, 'n-open', { i: '1' }); await tick(); await clickA(el, 'n-save'); await tick();
  assert.equal(cl.saves.length, 0); assert.match(el.html, /Nothing was changed/);
});

test('G s130: an empty note and a future date are refused before any call', async () => {
  const cl = notesClient(); const { el } = await mount(cl, GID + '/notes');
  await clickA(el, 'n-add'); await tick(); await clickA(el, 'n-save'); await tick();
  assert.match(el.html, /Write the note first/); assert.equal(cl.saves.length, 0);
  el.type('G_n_text', 'x'); el.type('G_n_date', '2026-12-01'); await clickA(el, 'n-save'); await tick();
  assert.match(el.html, /not in the future/); assert.equal(cl.saves.length, 0);
});

test('G s130: delete, then Undo writes the exact previous string back with the reason Note restored', async () => {
  const cl = notesClient(); const { el } = await mount(cl, GID + '/notes');
  await clickA(el, 'n-open', { i: '1' }); await tick(); await clickA(el, 'n-del'); await tick();
  assert.equal(cl.saves[0].p_reason, 'Note deleted'); assert.equal(cl.saves[0].p_patch.stay_preferences, '2026-10-10: !!! Allergic to nuts || 2026-09-01: Suggestion: a kettle');
  assert.match(el.html, /Note deleted\./); assert.match(el.html, /data-act="n-undo"/);
  await clickA(el, 'n-undo'); await tick();
  assert.equal(cl.saves[1].p_reason, 'Note restored'); assert.equal(cl.saves[1].p_patch.stay_preferences, NOTED);
  assert.equal(cl.saves[1].p_expected_version, 5);
});

test('G s130: a stale version reloads the screen and says Someone else changed these notes', async () => {
  const cl = notesClient(NOTED, () => ({ data: null, error: { code: '40001', message: 'stale version' } })); const { el } = await mount(cl, GID + '/notes');
  await clickA(el, 'n-add'); await tick(); el.type('G_n_text', 'Another'); await clickA(el, 'n-save'); await tick(); await tick();
  assert.match(el.html, /Someone else changed these notes\. Check the list, then try again\./);
});

test('G s130: a cleaner or finance role gets no notes screen controls', async () => {
  for (const role of ['cleaner', 'finance']) { const cl = notesClient(); const { el } = await mount(cl, GID + '/notes', role); assert.doesNotMatch(el.html, /n-add|n-save/, role); assert.equal(cl.saves.length, 0); }
});

test('G s130: the sheet marks Regular, !, !!, !!! as pressed buttons and the top level help carries no exclamation words', async () => {
  const { el } = await mount(notesClient(), GID + '/notes');
  await clickA(el, 'n-open', { i: '0' }); await tick();
  assert.match(el.html, /data-act="n-level" data-v="3" aria-pressed="true"/); assert.match(el.html, /data-act="n-level" data-v="0" aria-pressed="false"/);
  assert.match(el.html, /N_paper G_nsheet/);
});

// ------------------------------------------------------------------------------------------------ s130 fix round 1
const LONG = 'w'.repeat(700);
test('G s130 fix1 F1: a stored 700-character note opened and saved unchanged writes nothing; edited, the whole text is written; the field allows 700', async () => {
  const cl = notesClient('2026-10-10: ' + LONG + ' || 2026-10-11: short'); const { el } = await mount(cl, GID + '/notes');
  await clickA(el, 'n-open', { i: '0' }); await tick(); assert.match(el.html, /id="G_n_text"[^>]*maxlength="700"/);
  await clickA(el, 'n-save'); await tick(); assert.equal(cl.saves.length, 0); assert.match(el.html, /Nothing was changed/);
  const c2 = notesClient('2026-10-10: ' + LONG + ' || 2026-10-11: short'); const m2 = await mount(c2, GID + '/notes');
  await clickA(m2.el, 'n-open', { i: '0' }); await tick(); const o = m2.el.val('G_n_text'); assert.equal(o.length, 700);
  m2.el.type('G_n_text', 'v' + o.slice(1)); await clickA(m2.el, 'n-save'); await tick();
  assert.equal(c2.saves.length, 1); assert.equal(c2.saves[0].p_patch.stay_preferences, '2026-10-10: v' + LONG.slice(1) + ' || 2026-10-11: short');
  const c3 = notesClient(); const m3 = await mount(c3, GID + '/notes'); await clickA(m3.el, 'n-add'); await tick(); assert.match(m3.el.html, /id="G_n_text"[^>]*maxlength="600"/);
});

test('G s130 fix1 F2: saving without a change writes nothing for bare [addressed], a pipe inside a word and a mid-text [addressed date]', async () => {
  for (const stored of ['Fix the drain [addressed]', 'AC|fan please', 'Was [addressed 2026-01-01] again']) {
    const cl = notesClient(stored); const { el } = await mount(cl, GID + '/notes');
    await clickA(el, 'n-open', { i: '0' }); await tick(); await clickA(el, 'n-save'); await tick();
    assert.equal(cl.saves.length, 0, stored); assert.match(el.html, /Nothing was changed/, stored);
  }
  const cl = notesClient('Fix the drain [addressed]'); const { el } = await mount(cl, GID + '/notes');
  await clickA(el, 'n-open', { i: '0' }); await tick(); await clickA(el, 'n-level', { v: '2' }); await clickA(el, 'n-save'); await tick();
  assert.equal(cl.saves[0].p_patch.stay_preferences, '!! Fix the drain [addressed]', 'a changed level keeps the bare [addressed] bare');
});

test('G s130 fix1 F3: a note that is only a marker is kept when another note is saved', async () => {
  const cl = notesClient('Likes tea || Suggestion: [addressed]'); const { el } = await mount(cl, GID + '/notes');
  await clickA(el, 'n-add'); await tick(); el.type('G_n_text', 'Needs a crib'); await clickA(el, 'n-save'); await tick();
  assert.equal(cl.saves[0].p_patch.stay_preferences, 'Likes tea || Suggestion: [addressed] || 2026-10-14: Needs a crib');
});

test('G s130 fix1 F4: a legacy note dated in the future saves after only its importance changes; a changed future date is still refused', async () => {
  const cl = notesClient('2026-12-24: Christmas stay'); const { el } = await mount(cl, GID + '/notes');
  await clickA(el, 'n-open', { i: '0' }); await tick(); await clickA(el, 'n-level', { v: '2' }); await clickA(el, 'n-save'); await tick();
  assert.equal(cl.saves.length, 1); assert.equal(cl.saves[0].p_patch.stay_preferences, '2026-12-24: !! Christmas stay');
  const c2 = notesClient('2026-12-24: Christmas stay'); const m2 = await mount(c2, GID + '/notes');
  await clickA(m2.el, 'n-open', { i: '0' }); await tick(); m2.el.type('G_n_date', '2026-12-25'); await clickA(m2.el, 'n-save'); await tick();
  assert.match(m2.el.html, /not in the future/); assert.equal(c2.saves.length, 0);
});

const prefClient = (stored) => reviewClient(() => ({ status: 200, j: { ok: true, saved: [{ what: 'profile', ok: true }] } }), PROPOSAL, { tables: { guests: { data: GUEST, error: null }, guest_profile_details: { data: { ...PROFILE, stay_preferences: stored }, error: null } } });
const lastSave = (cl) => cl.fcalls.filter((c) => c[1].action === 'save').pop()[1];
test('G s130 fix1 F6: Add guest details does not append a preference already on file (trimmed, any case); a new one is still dated and sent', async () => {
  const cl = prefClient('2026-10-01: Allergic to nuts'); const { el } = await toReviewWith(cl);
  await clickA(el, 'save-add'); await tick();
  const b = lastSave(cl); assert.equal('stay_preferences' in b, false, 'all duplicates: not sent'); assert.equal(b.phone, '09175550000', 'the rest is still saved');
  const c2 = prefClient('Quiet room'); const m2 = await toReviewWith(c2); m2.el.type('G_r_pref', '  allergic TO nuts '); await clickA(m2.el, 'save-add'); await tick();
  assert.equal(lastSave(c2).stay_preferences, '2026-10-14: allergic TO nuts', 'not on file: sent with the date');
  const c3 = prefClient('2026-10-01: Allergic to nuts'); const m3 = await toReviewWith(c3); m3.el.type('G_r_pref', ' allergic TO nuts \nLikes a quiet room'); await clickA(m3.el, 'save-add'); await tick();
  assert.equal(lastSave(c3).stay_preferences, '2026-10-14: Likes a quiet room', 'only the new one is sent');
  const c4 = prefClient('2026-10-01: Allergic to nuts'); const m4 = await toReviewWith(c4); m4.el.type('G_r_pref', 'Allergic to nuts and shellfish'); await clickA(m4.el, 'save-add'); await tick();
  assert.equal(lastSave(c4).stay_preferences, '2026-10-14: Allergic to nuts and shellfish', 'a longer text is not a duplicate');
});
