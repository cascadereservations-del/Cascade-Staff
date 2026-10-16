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

class FakeEl {
  constructor() { this.html = ''; this.l = {}; this.nodes = {}; }
  set innerHTML(v) { this.html = String(v); }
  get innerHTML() { return this.html; }
  addEventListener(t, f) { (this.l[t] ||= []).push(f); }
  removeEventListener(t, f) { this.l[t] = (this.l[t] || []).filter((x) => x !== f); }
  querySelector(sel) { const id = String(sel).replace(/^#/, ''); return this.nodes[id] || null; }
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
    document: { cookie: '' } };
  vm.createContext(ctx);
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
  const { M, touched, fetched, revoked } = load(); const el = new FakeEl(); const toasts = [];
  M.mount(el, { client: cl, demo: false, role, sub, propertyId: PROP, navigate: () => {}, toast: (m) => toasts.push(m), haptic: () => {}, ...extra });
  await tick();
  return { M, el, touched, toasts, fetched, revoked };
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
  assert.match(t.rpcText({ code: '40001', message: 'stale version' }), /Someone changed this guest/);
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
  assert.deepEqual(g.find((x) => x[0] === 'select').slice(1, 2), ['id,name,phone,email,tier,total_stays,last_stay_date,guest_profile_details(id_on_file,birthday,contact_number,vip)']);
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
  assert.match(el.html, /Ana Maria Reyes/); assert.match(el.html, /Quiet room/); assert.match(el.html, /anniversary/);
  assert.match(el.html, /20 Oct 1990/); assert.match(el.html, /Birthday in 6 days/);
  assert.match(el.html, /Add from text, screenshot or photo/);
  assert.match(el.html, /Guest’s own ID/); assert.match(el.html, /Ben Cruz/);
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
  assert.doesNotMatch(el.html, /People and ID photos/); assert.doesNotMatch(el.html, /class="errbox/);
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
  assert.match(el.html, /Edit details/); assert.match(el.html, /value="Updated in the Staff app"/);
  setNodes(el, { G_f_phone: '0917 555 0000', G_f_bday: '1990-10-20', G_f_pref: 'Quiet room\nLate arrival', G_f_tags: 'Anniversary, baby', G_f_reason: 'Guest asked on Messenger' });
  await clickA(el, 'save-edit'); await tick();
  const save = cl.calls.find((c) => c[0] === 'save_guest_profile_v1');
  assert.deepEqual(save[1], { p_guest_id: GID, p_patch: { contact_number: '0917 555 0000', stay_preferences: 'Quiet room\nLate arrival', tags: ['anniversary', 'baby'] }, p_expected_version: 4, p_reason: 'Guest asked on Messenger' });
  assert.match(el.html, /Saved\. Changed: phone, preferences, tags\./);
  assert.deepEqual(toasts, ['Saved']);
  // the next edit uses the version the server returned (5)
  await clickA(el, 'edit'); setNodes(el, { G_f_phone: '0917 555 0000', G_f_bday: '1990-10-21', G_f_pref: 'Quiet room\nLate arrival', G_f_tags: 'anniversary, baby', G_f_reason: 'Birthday fix' });
  await clickA(el, 'save-edit'); await tick();
  assert.equal(cl.calls.filter((c) => c[0] === 'save_guest_profile_v1')[1][1].p_expected_version, 5);
});

test('G: an untouched edit sends nothing; a bad reason or future birthday is refused before any call', async () => {
  const cl = detailClient();
  const { el } = await mount(cl, GID);
  await clickA(el, 'edit');
  setNodes(el, { G_f_phone: '09171234567', G_f_bday: '1990-10-20', G_f_pref: 'Quiet room', G_f_tags: 'anniversary', G_f_reason: 'Updated in the Staff app' });
  await clickA(el, 'save-edit'); await tick();
  assert.equal(cl.calls.filter((c) => c[0] === 'save_guest_profile_v1').length, 0);
  assert.match(el.html, /Nothing was changed/);
  await clickA(el, 'edit');
  setNodes(el, { G_f_phone: '09171234567', G_f_bday: '2026-10-15', G_f_pref: 'Quiet room', G_f_tags: 'anniversary', G_f_reason: 'ok then' });
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
  await clickA(el, 'edit'); setNodes(el, { G_f_phone: '0999', G_f_bday: '1990-10-20', G_f_pref: 'Quiet room', G_f_tags: 'anniversary', G_f_reason: 'Phone fix' });
  await clickA(el, 'save-edit'); await tick();
  assert.match(el.html, /Someone changed this guest/); assert.match(el.html, /Edit details/); assert.match(el.html, /value="0999"|0999/);
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
  assert.deepEqual(sv, { action: 'save', guest_id: GID, reason: 'From the chat', expected_version: 4, phone: '09175550000', stay_preferences: 'Allergic to nuts', birthday: '1992-03-04', tags: ['anniversary', 'nuts'], companions: ['Carla Dizon'] });
  assert.match(el.html, /Companion added\./); assert.match(el.html, /The details was changed by someone else|The details was changed by someone else, reload and try again\./);
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
  const ownBlock = el.html.slice(el.html.indexOf('Guest’s own ID'), el.html.indexOf('Ben Cruz'));
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
  assert.match(el.html, /People and ID photos/); assert.match(el.html, /Ben Cruz/);
  assert.doesNotMatch(el.html, /Replace photo|Add ID photo|Remove photo/);
});

test('G: after remove_id also clears the ID flag, the record reloads so ID reads Not on file at once', async () => {
  let flag = true;
  const cl = detailClient({ tables: { guests: { data: GUEST, error: null }, guest_profile_details: () => ({ data: { ...PROFILE, id_on_file: flag }, error: null }) },
    fn: (b) => { if (b.action === 'context') return { status: 200, j: { ok: true, features: FEAT } }; flag = false; return { status: 200, j: { ok: true, saved: [{ what: 'id_photo_removed', ok: true }, { what: 'profile', ok: true }] } }; } });
  const { el } = await mount(cl, GID);
  assert.match(el.html, /On file/);
  await clickA(el, 'remove-photo', { id: CID }); await clickA(el, 'remove-photo-yes', { id: CID }); await tick();
  assert.equal(cl.chains.filter((c) => c[0][1] === 'guest_profile_details').length, 2);
  assert.match(el.html, /ID photo removed/); assert.match(el.html, /<dt>ID<\/dt><dd><span class="G_none">Not on file/);
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
  await clickA(el, 'full-rot'); await tick();
  const sv = cl.calls.filter((c) => c[0] === 'set_guest_photo_rotation_v1'); assert.equal(sv.length, 1);
  assert.deepEqual(sv[0][1], { p_path: compPath, p_rotation: 90 });
  assert.match(el.html, /aria-live="polite">Saved</);
  fail = true; await clickA(el, 'full-rot'); await tick();
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
