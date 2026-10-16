// s91: the ID photo turn. Saved rotation (staff_photo_rotation_v1) wins over the auto guess, the auto guess is 270, Rotate saves for owner/admin only, 180 has a class.
import test from 'node:test';
import assert from 'node:assert/strict';
import { read, boot, baseHandlers, el, HOMEWITH, stayRow } from './_a_harness.mjs';

const PATH = 'g1/id.jpg';
const guest = { guest_name: 'Ana Reyes', checkin_date: '2026-10-14', checkout_date: '2026-10-17', status: 'confirmed', source: 'direct', arrival_ready: null, id_photo_path: PATH, uid: 'u1', guest_id: 'g1' };
let n = 0;
class U extends URL { static createObjectURL() { return 'blob:s91/' + (++n); } static revokeObjectURL() {} }
function box() {
  const b = { attrs: { 'data-idpath': PATH }, cls: new Set(), kids: [], style: { setProperty(k, v) { b.style[k] = v; } }, className: '', innerHTML: '',
    getAttribute: (k) => (k in b.attrs ? b.attrs[k] : null), setAttribute() {}, appendChild: (c) => b.kids.push(c),
    classList: { toggle: (c, on) => (on ? b.cls.add(c) : b.cls.delete(c)), add: (c) => b.cls.add(c), remove: (c) => b.cls.delete(c), contains: (c) => b.cls.has(c) } };
  return b;
}
// Boots the Home screen with one guest card; returns the box the photo lands in, plus the images created.
async function home(role, handlers = {}) {
  const b = box(), imgs = [], v = el(); v.querySelectorAll = (q) => (q === '[data-idpath]' ? [b] : []);
  class I {
    constructor() { this.l = {}; this.naturalWidth = 500; this.naturalHeight = 800; imgs.push(this); }
    addEventListener(t, f) { (this.l[t] ||= []).push(f); }
    set src(x) { this._s = x; setImmediate(() => (this.l.load || []).forEach((f) => f())); }
    get src() { return this._s; }
  }
  const full = el(), st = { textContent: '' }, fimg = { className: '' }, attrs = {};
  full.setAttribute = (k, x) => { attrs[k] = x; }; full.getAttribute = (k) => attrs[k] || null; full.querySelector = (q) => (q === 'img' ? fimg : q === '.H_idst' ? st : null);
  const app = await boot({ role, hash: '#calendar/house', els: { 'v-calendar': v, H_idfull: full }, ctxExtra: { Image: I, URL: U },
    storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: { signedUrl: 'https://signed.test/x' }, error: null }) }) },
    foldFetch: (u) => Promise.resolve(/signed/.test(String(u)) ? { ok: true, blob: () => Promise.resolve({}) } : { ok: false }),
    handlers: baseHandlers(role, Object.assign({ staff_home_v1: () => HOMEWITH([stayRow('Ana Reyes', '2026-10-14', '2026-10-17')], { current_guest: guest }) }, handlers)) });
  await app.flush();
  return { app, b, imgs, full, st, fimg };
}
const rotCalls = (app) => app.calls.filter((c) => c[0] === 'staff_photo_rotation_v1');
const saves = (app) => app.calls.filter((c) => c[0] === 'set_guest_photo_rotation_v1');
const deg = (b) => b.style['--deg'];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const press = async (app, act, extra = {}) => { const btn = { getAttribute: (k) => (k === 'data-act' ? act : null), hasAttribute: (k) => k === 'data-act', ...extra }; for (const fn of app.listeners.click || []) fn({ target: { closest: () => btn } }); await app.flush(); };

async function rotateFlow(role, handlers) {
  const c = await home(role, handlers);
  const url = c.imgs[0].src;
  await press(c.app, 'id-full', { querySelector: () => ({ src: url }) });
  return { ...c, tap: () => press(c.app, 'id-rot') };
}

test('s91 auto guess for a tall photo with no saved turn is 270 (counter-clockwise)', async () => {
  const { b } = await home('owner', { staff_photo_rotation_v1: () => ({ error: null, data: [] }) });
  assert.equal(deg(b), '270deg'); assert.ok(b.cls.has('rot'));
});

test('s91 the saved rotation is fetched once, batched, and beats the auto guess', async () => {
  const { app, b } = await home('owner', { staff_photo_rotation_v1: () => ({ error: null, data: [{ path: PATH, rotation: 180 }] }) });
  assert.equal(rotCalls(app).length, 1); assert.deepEqual(rotCalls(app)[0][1], { p_paths: [PATH] });
  assert.equal(deg(b), '180deg'); assert.ok(b.cls.has('r180')); assert.equal(b.cls.has('rot'), false);
});

test('s91 a saved 0 also beats the auto turn', async () => {
  const { b } = await home('owner', { staff_photo_rotation_v1: () => ({ error: null, data: [{ path: PATH, rotation: 0 }] }) });
  assert.equal(deg(b), '0deg');
});

test('s91 the RPC missing (error) falls back to the auto guess, silently', async () => {
  const { app, b } = await home('owner', { staff_photo_rotation_v1: () => ({ error: { code: 'PGRST202', message: 'missing' }, data: null }) });
  assert.equal(rotCalls(app).length, 1); assert.equal(deg(b), '270deg');
});

test('s91 Rotate: owner saves each +90 and sees Saved', async () => {
  const { app, tap, st, fimg } = await rotateFlow('owner', { staff_photo_rotation_v1: () => ({ error: null, data: [{ path: PATH, rotation: 90 }] }), set_guest_photo_rotation_v1: (a) => ({ error: null, data: { ok: true, path: a.p_path, rotation: a.p_rotation } }) });
  await tap(); await wait(700); await app.flush();
  assert.deepEqual(saves(app)[0][1], { p_path: PATH, p_rotation: 180 });
  assert.equal(fimg.className, 'r180'); assert.equal(st.textContent, 'Saved for everyone');
  await tap(); await wait(700); await app.flush(); assert.equal(saves(app)[1][1].p_rotation, 270); assert.equal(fimg.className, 'r270');
});

test('s91 Rotate: a failed save says Could not save but the picture still turns', async () => {
  const { app, tap, st, fimg } = await rotateFlow('admin', { set_guest_photo_rotation_v1: () => ({ error: { message: 'x' }, data: null }) });
  await tap(); await wait(700); await app.flush(); assert.equal(st.textContent, 'Could not save'); assert.match(fimg.className, /^r\d+$/);
});

test('s91 Rotate: a cleaner gets no full-screen button and never calls the save RPC', async () => {
  const { app, b, imgs, full } = await home('cleaner', { set_guest_photo_rotation_v1: () => ({ error: null, data: { ok: true } }) });
  assert.ok(b.kids.length > 0 && b.kids.every((k) => imgs.includes(k)), 'bare pictures, no id-full button');
  await press(app, 'id-full', { querySelector: () => ({ src: imgs[0].src }) }); await press(app, 'id-rot');
  assert.equal(saves(app).length, 0);
});

test('s91 app.js: 180 has a class, nothing personal is stored, the race guards stay', () => {
  const src = read('app.js'), css = read('styles.css');
  assert.match(css, /\.H_idfull img\.r180/); assert.match(css, /\.idphoto\.r180 img/);
  const part = src.slice(src.indexOf('function H_rotLoad'), src.indexOf('function dropPhotos'));
  assert.equal(/localStorage|sessionStorage|caches\.open|indexedDB/.test(part), false);
  assert.match(part, /gen !== state\.photoGen/); assert.match(src, /state\.srot = \{\}; state\.rotReq = \{\};/);
});

test('s91 full view: the picture sits in a size container above the bar, on an opaque background, in both views; demo answers the save', () => {
  const css = read('styles.css'), g = read('guests/G_guests.css');
  assert.match(css, /\.H_idbox \{[^}]*container-type: size/); assert.match(css, /\.H_idfull \{[^}]*background: var\(--v5-bg\)/); assert.doesNotMatch(css, /\.H_idfull \{[^}]*scrim/);
  assert.match(css, /\.H_idfull img\.r90, \.H_idfull img\.r270 \{ width: 100cqh; height: 100cqw/);
  assert.match(g, /\.G_full \{[^}]*background: var\(--v5-bg\)/); assert.match(g, /\.G_full img\.G_r90, \.G_full img\.G_r270 \{ width: calc\(100cqh/);
  assert.match(read('demo.js'), /case 'set_guest_photo_rotation_v1': return done\(\{ ok: true/);
});

test('s91 three quick Rotate taps send exactly one write, of the last value, and cache it', async () => {
  const { app, tap, st } = await rotateFlow('owner', { staff_photo_rotation_v1: () => ({ error: null, data: [{ path: PATH, rotation: 0 }] }), set_guest_photo_rotation_v1: (a) => ({ error: null, data: { ok: true, path: a.p_path, rotation: a.p_rotation } }) });
  await tap(); await tap(); await tap(); assert.equal(saves(app).length, 0, 'nothing sent while tapping');
  await wait(700); await app.flush();
  assert.equal(saves(app).length, 1); assert.equal(saves(app)[0][1].p_rotation, 270); assert.equal(st.textContent, 'Saved for everyone');
});

test('s91 a rotation read that never answers does not hold the photo back (auto guess after 2.5 s)', async () => {
  const t0 = Date.now();
  const { b } = await home('owner', { staff_photo_rotation_v1: () => new Promise(() => {}) });
  assert.equal(deg(b), undefined, 'still waiting at first');
  await wait(2700); assert.equal(deg(b), '270deg'); assert.ok(Date.now() - t0 < 5000);
});
